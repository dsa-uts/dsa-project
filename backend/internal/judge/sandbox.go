package judge

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/containerd/errdefs"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	resource "github.com/dsa-uts/dsa-resource-spec"
	"github.com/google/uuid"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/client"
)

const (
	submissionUID        = 10001
	initUser             = "10000:10000"
	submissionUser       = "10001:10001"
	startupTimeout       = 180 * time.Second
	placementTimeout     = 20 * time.Second
	captureTimeout       = 20 * time.Second
	removalTimeout       = 20 * time.Second
	cleanupTimeout       = 2 * time.Second
	apiTimeout           = 2 * time.Second
	memoryInterval       = 10 * time.Millisecond
	memoryHardMultiplier = 2
	workspaceLabel       = "dsa.workspace"
)

type sandbox struct {
	id         string
	cgroupPath string
}

func sandboxName(ws *workspace) string {
	return "dsa-sandbox-" + filepath.Base(ws.path)
}

// Retry only operations that can be reconciled or safely repeated. In
// particular, Step exec creation/start/attach must never use this helper.
func retryDocker(ctx context.Context, operation func(context.Context) error) error {
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		err = operation(ctx)
		if err == nil {
			return nil
		}
		if errdefs.IsNotFound(err) || errdefs.IsInvalidArgument(err) ||
			errdefs.IsPermissionDenied(err) || errdefs.IsUnauthorized(err) {
			return err
		}
		if attempt < 2 {
			if err := wait(ctx, time.Second); err != nil {
				return err
			}
		}
	}
	return err
}

func (w *worker) inspectSandbox(ctx context.Context, id string) (container.InspectResponse, error) {
	var result client.ContainerInspectResult
	err := retryDocker(ctx, func(ctx context.Context) error {
		callCtx, cancel := context.WithTimeout(ctx, apiTimeout)
		defer cancel()
		var err error
		result, err = w.docker.ContainerInspect(callCtx, id, client.ContainerInspectOptions{})
		return err
	})
	return result.Container, err
}

func (w *worker) startSandbox(
	ctx context.Context,
	req *store.Request,
	ws *workspace,
	workflowID, jobID string,
	job resource.Job,
) (*sandbox, error) {
	ctx, cancel := context.WithTimeout(ctx, startupTimeout)
	defer cancel()

	if err := retryDocker(ctx, func(ctx context.Context) error {
		_, err := w.docker.ImageInspect(ctx, string(job.SandboxImage))
		if err == nil || !errdefs.IsNotFound(err) {
			return err
		}
		pull, err := w.docker.ImagePull(ctx, string(job.SandboxImage), client.ImagePullOptions{})
		if err != nil {
			return err
		}
		defer pull.Close()
		return pull.Wait(ctx)
	}); err != nil {
		return nil, fmt.Errorf("pull sandbox image: %w", err)
	}

	pidLimit := int64(job.Limits.PIDs)
	initEnabled := true
	hardMemory := job.Limits.Memory * memoryHardMultiplier
	options := client.ContainerCreateOptions{
		Name: sandboxName(ws),
		Config: &container.Config{
			Image:      string(job.SandboxImage),
			User:       initUser,
			WorkingDir: "/workspace",
			Entrypoint: []string{"/bin/bash", "-c"},
			Cmd:        []string{`trap 'exit 0' TERM INT; while :; do sleep 86400 & wait "$!"; done`},
			Labels: map[string]string{
				workspaceLabel: filepath.Base(ws.path),
				"dsa.owner":    w.ownerID.String(),
				"dsa.request":  req.ID.String(),
				"dsa.attempt":  strconv.Itoa(int(req.AttemptCount)),
				"dsa.workflow": workflowID,
				"dsa.job":      jobID,
			},
		},
		HostConfig: &container.HostConfig{
			Init:           &initEnabled,
			NetworkMode:    "none",
			ReadonlyRootfs: true,
			CapDrop:        []string{"ALL"},
			SecurityOpt:    []string{"no-new-privileges:true"},
			LogConfig:      container.LogConfig{Type: "none"},
			Resources: container.Resources{
				NanoCPUs:   int64(job.Limits.CPU) * 1_000_000_000,
				Memory:     hardMemory,
				MemorySwap: hardMemory,
				PidsLimit:  &pidLimit,
			},
			Mounts: []mount.Mount{
				{Type: mount.TypeBind, Source: ws.dataPath("workspace"), Target: "/workspace"},
				{Type: mount.TypeBind, Source: ws.dataPath("tmp"), Target: "/tmp"},
				{Type: mount.TypeBind, Source: ws.dataPath("shm"), Target: "/dev/shm"},
				{Type: mount.TypeBind, Source: filepath.Join(ws.path, "preset"), Target: "/preset", ReadOnly: true},
			},
		},
	}

	var id string
	if err := retryDocker(ctx, func(ctx context.Context) error {
		// A timed-out create may have succeeded. Resolve its fixed name first.
		existing, err := w.docker.ContainerInspect(ctx, options.Name, client.ContainerInspectOptions{})
		if err == nil {
			if existing.Container.Config == nil || existing.Container.Config.Labels[workspaceLabel] != filepath.Base(ws.path) {
				return errdefs.ErrInvalidArgument.WithMessage("sandbox name belongs to another workspace")
			}
			id = existing.Container.ID
			return nil
		}
		if !errdefs.IsNotFound(err) {
			return err
		}
		created, err := w.docker.ContainerCreate(ctx, options)
		id = created.ID
		return err
	}); err != nil {
		return nil, fmt.Errorf("create sandbox: %w", err)
	}
	if err := retryDocker(ctx, func(ctx context.Context) error {
		_, err := w.docker.ContainerStart(ctx, id, client.ContainerStartOptions{})
		return err
	}); err != nil {
		return nil, fmt.Errorf("start sandbox: %w", err)
	}
	state, err := w.inspectSandbox(ctx, id)
	if err != nil {
		return nil, err
	}
	if state.State == nil || !state.State.Running {
		return nil, errors.New("sandbox exited during startup")
	}
	cgroupPath, err := sandboxCgroup(state.State.Pid)
	if err != nil {
		return nil, err
	}
	sb := &sandbox{id: id, cgroupPath: cgroupPath}
	if err := w.verifySubmissionUser(ctx, sb); err != nil {
		return nil, fmt.Errorf("verify sandbox permissions: %w", err)
	}
	return sb, nil
}

func sandboxCgroup(pid int) (string, error) {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/cgroup", pid))
	if err != nil {
		return "", err
	}
	var cgroup string
	for _, line := range strings.Split(string(data), "\n") {
		if path, ok := strings.CutPrefix(line, "0::"); ok {
			cgroup = path
			break
		}
	}
	if cgroup == "" {
		return "", errors.New("sandbox requires cgroup v2")
	}
	mounts, err := os.ReadFile("/proc/self/mountinfo")
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(mounts), "\n") {
		fields := strings.Fields(line)
		separator := slices.Index(fields, "-")
		if separator < 6 || separator+1 >= len(fields) || fields[separator+1] != "cgroup2" {
			continue
		}
		relative, err := filepath.Rel(fields[3], cgroup)
		if err != nil || relative == "." || !filepath.IsLocal(relative) {
			continue
		}
		path := filepath.Join(fields[4], relative)
		if _, err := os.Stat(filepath.Join(path, "memory.current")); err != nil {
			return "", err
		}
		return path, nil
	}
	return "", errors.New("sandbox cgroup is not visible to Judge")
}

func (w *worker) stopSandbox(ctx context.Context, sb *sandbox) error {
	ctx, cancel := context.WithTimeout(ctx, removalTimeout)
	defer cancel()
	if err := retryDocker(ctx, func(ctx context.Context) error {
		state, err := w.inspectSandbox(ctx, sb.id)
		if err != nil {
			return err
		}
		if state.State == nil {
			return errors.New("sandbox has no state")
		}
		if !state.State.Running {
			return nil
		}
		_, err = w.docker.ContainerKill(ctx, sb.id, client.ContainerKillOptions{Signal: "SIGKILL"})
		return err
	}); err != nil {
		return err
	}
	for {
		state, err := w.inspectSandbox(ctx, sb.id)
		if err != nil {
			return err
		}
		if state.State != nil && !state.State.Running {
			return nil
		}
		if err := wait(ctx, 2*time.Second); err != nil {
			return err
		}
	}
}

func (w *worker) removeContainer(ctx context.Context, id string) error {
	err := retryDocker(ctx, func(ctx context.Context) error {
		_, err := w.docker.ContainerRemove(ctx, id, client.ContainerRemoveOptions{Force: true, RemoveVolumes: true})
		if errdefs.IsNotFound(err) {
			return nil
		}
		return err
	})
	if err != nil {
		return err
	}
	for {
		_, err := w.inspectSandbox(ctx, id)
		if errdefs.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if err := wait(ctx, 2*time.Second); err != nil {
			return err
		}
	}
}

func newWorkspace() (*workspace, error) {
	name := uuid.NewString()
	path := filepath.Join(workspaceDirectory, name)
	if err := os.Mkdir(path, 0700); err != nil {
		return nil, err
	}
	return &workspace{path: path}, nil
}

func (w *worker) releaseSandbox(ctx context.Context, ws *workspace) error {
	if err := w.removeContainer(ctx, sandboxName(ws)); err != nil {
		return err
	}
	return ws.remove(ctx)
}

func (w *worker) reapSandboxes(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, removalTimeout)
	defer cancel()
	var containers client.ContainerListResult
	if err := retryDocker(ctx, func(ctx context.Context) error {
		var err error
		containers, err = w.docker.ContainerList(ctx, client.ContainerListOptions{
			All: true,
		})
		return err
	}); err != nil {
		return err
	}
	for _, item := range containers.Items {
		if err := w.removeContainer(ctx, item.ID); err != nil {
			return err
		}
	}
	entries, err := os.ReadDir(workspaceDirectory)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if _, err := uuid.Parse(entry.Name()); err != nil || !entry.IsDir() {
			return fmt.Errorf("unexpected entry in workspace directory: %q", entry.Name())
		}
		ws := &workspace{path: filepath.Join(workspaceDirectory, entry.Name())}
		if err := ws.remove(ctx); err != nil {
			return err
		}
	}
	return ctx.Err()
}

func (w *worker) sandboxOOM(ctx context.Context, sb *sandbox, since time.Time) (bool, error) {
	// The finite event query also works after Docker has removed the cgroup.
	ctx, cancel := context.WithTimeout(ctx, apiTimeout)
	defer cancel()
	events := w.docker.Events(ctx, client.EventsListOptions{
		Since:   since.Format(time.RFC3339Nano),
		Until:   time.Now().Format(time.RFC3339Nano),
		Filters: make(client.Filters).Add("container", sb.id).Add("event", "oom"),
	})
	for {
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-events.Messages:
			return true, nil
		case err := <-events.Err:
			if errors.Is(err, io.EOF) {
				return false, nil
			}
			return false, err
		}
	}
}
