package judge

import (
	"bytes"
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
	"github.com/moby/moby/api/pkg/stdcopy"
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
	for attempt := range 3 {
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
	job resource.Job) (*sandbox, error) {
	ctx, cancel := context.WithTimeout(ctx, startupTimeout)
	defer cancel()

	if err := w.ensureSandboxImage(ctx, string(job.SandboxImage)); err != nil {
		return nil, err
	}

	options := w.sandboxOptions(req, ws, workflowID, jobID, job)

	id, err := w.createSandbox(ctx, ws, options)
	if err != nil {
		return nil, err
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
	// ex. data := "0::/system.slice/systemd-networkd.service"
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/cgroup", pid))
	if err != nil {
		return "", err
	}
	var cgroup string
	for line := range strings.SplitSeq(string(data), "\n") {
		if path, ok := strings.CutPrefix(line, "0::"); ok {
			// ex. cgroup := "/system.slice/systemd-networkd.service"
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
	for line := range strings.SplitSeq(string(mounts), "\n") {
		// Looking for a field like this in mountinfo.
		// -------------------------------------------------------
		// 160 100 0:32 / /sys/fs/cgroup rw,nosuid,nodev,noexec,relatime shared:57 - cgroup2 none rw,nsdelegate
		// -------------------------------------------------------
		fields := strings.Fields(line)
		separator := slices.Index(fields, "-")
		// 6 is a number of first mandate fields in mountinfo.
		// see: https://man7.org/linux/man-pages/man5/proc_pid_mountinfo.5.html#top_of_page.
		if separator < 6 || separator+1 >= len(fields) || fields[separator+1] != "cgroup2" {
			continue
		}
		// fields[3] := root: the pathname of the directory in the filesystem
		//              which forms the root of this mount.
		// ex. fields[3] = "/"]
		relative, err := filepath.Rel(fields[3], cgroup)
		// In this example,
		// relative = filepath.Rel(basePath = "/", targetPath = "/system.slice/systemd-networkd.service")
		//          = "system.slice/systemd-networkd.service"
		if err != nil || relative == "." || !filepath.IsLocal(relative) {
			continue
		}
		// fields[4] := mount point: the pathname of the mount point relative
		//              to the process's root directory.
		// ex. fields[4] = "/sys/fs/cgroup"
		path := filepath.Join(fields[4], relative)
		// In this example,
		// path = filepath.Join("/sys/fs/cgroup", "system.slice/systemd-networkd.service")
		//      = "/sys/fs/cgroup/system.slice/systemd-networkd.service"
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

func (w *worker) ensureSandboxImage(ctx context.Context, image string) error {
	if err := retryDocker(ctx, func(ctx context.Context) error {
		_, err := w.docker.ImageInspect(ctx, image)
		if err == nil || !errdefs.IsNotFound(err) {
			return err
		}
		// TODO: GHCRプライベートレジストリに対応
		pull, err := w.docker.ImagePull(ctx, image, client.ImagePullOptions{})
		if err != nil {
			return err
		}
		defer pull.Close()
		return pull.Wait(ctx)
	}); err != nil {
		return fmt.Errorf("pull sandbox image: %w", err)
	}

	return nil
}

func (w *worker) sandboxOptions(req *store.Request, ws *workspace, workflowID, jobID string, job resource.Job) client.ContainerCreateOptions {
	pidLimit := int64(job.Limits.PIDs)
	initEnabled := true
	hardMemory := job.Limits.Memory * memoryHardMultiplier
	return client.ContainerCreateOptions{
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
			NanoCPUs:       int64(job.Limits.CPU) * 1_000_000_000,
			Memory:         hardMemory,
			MemorySwap:     hardMemory,
			PidsLimit:      &pidLimit,
			Mounts: []mount.Mount{
				{Type: mount.TypeBind, Source: ws.workspacePath(), Target: "/workspace"},
				{Type: mount.TypeBind, Source: ws.tmpPath(), Target: "/tmp"},
				{Type: mount.TypeBind, Source: ws.shmPath(), Target: "/dev/shm"},
				{Type: mount.TypeBind, Source: ws.presetPath(), Target: "/preset", ReadOnly: true},
			},
		},
	}

}

// createSandbox reconciles a timed-out create by looking up the fixed name.
func (w *worker) createSandbox(ctx context.Context, ws *workspace, options client.ContainerCreateOptions) (string, error) {
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
		return "", fmt.Errorf("create sandbox: %w", err)
	}
	return id, nil
}

type memorySample struct {
	bytes    int64
	oomKills int64
}

func sampleMemory(sb *sandbox) (memorySample, error) {
	current, err := os.ReadFile(filepath.Join(sb.cgroupPath, "memory.current"))
	if err != nil {
		return memorySample{}, err
	}
	usage, err := strconv.ParseInt(strings.TrimSpace(string(current)), 10, 64)
	if err != nil {
		return memorySample{}, err
	}
	events, err := os.ReadFile(filepath.Join(sb.cgroupPath, "memory.events"))
	if err != nil {
		return memorySample{}, err
	}
	for line := range strings.SplitSeq(string(events), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "oom_kill" {
			kills, err := strconv.ParseInt(fields[1], 10, 64)
			return memorySample{bytes: usage, oomKills: kills}, err
		}
	}
	return memorySample{}, errors.New("memory.events has no oom_kill counter")
}

func (w *worker) runControlExec(ctx context.Context, sb *sandbox, command []string, stdout io.Writer) error {
	created, err := w.docker.ExecCreate(ctx, sb.id, client.ExecCreateOptions{
		User: submissionUser, WorkingDir: "/workspace", Cmd: command,
		AttachStdout: true, AttachStderr: true,
	})
	if err != nil {
		return err
	}
	stream, err := w.docker.ExecAttach(ctx, created.ID, client.ExecAttachOptions{})
	if err != nil {
		return err
	}
	defer stream.Close()
	// StdCopy does not observe ctx, so cancellation must close the connection
	// to unblock its reads. The deferred Close also runs on error; closing the
	// underlying network connection again (or concurrently) is safe.
	stopClosing := context.AfterFunc(ctx, stream.Close)
	defer stopClosing()
	if _, err := stdcopy.StdCopy(stdout, io.Discard, stream.Reader); err != nil {
		return err
	}
	for {
		state, err := w.inspectExec(ctx, created.ID)
		if err != nil {
			return err
		}
		if !state.Running {
			if state.ExitCode != 0 {
				return fmt.Errorf("control exec exit code %d", state.ExitCode)
			}
			return nil
		}
		if err := wait(ctx, execPollInterval); err != nil {
			return err
		}
	}
}

func (w *worker) cleanupSubmission(ctx context.Context, sb *sandbox) error {
	// With no capabilities, kill(-1) can signal only this UID's processes.
	// PID 1 uses another UID; the calling shell is excluded by Linux itself.
	// ponytail: best-effort UID cleanup races with fork; Job teardown kills all.
	return w.runControlExec(ctx, sb, []string{"/bin/bash", "-c", "kill -KILL -- -1 || true"}, io.Discard)
}

func (w *worker) verifySubmissionUser(ctx context.Context, sb *sandbox) error {
	ctx, cancel := context.WithTimeout(ctx, cleanupTimeout)
	defer cancel()
	var output bytes.Buffer
	command := []string{
		"/bin/bash", "-c",
		`while IFS= read -r line; do printf '%s\n' "$line"; done < /proc/self/status`,
	}
	if err := w.runControlExec(ctx, sb, command, &output); err != nil {
		return err
	}
	/* output of command (just pring /proc/self/status) looks like:

	~$ while IFS= read -r line; do printf '%s\n' "$line"; done < /proc/self/status
	Name:   bash
	Umask:  0022
	State:  R (running)
	Tgid:   360237
	Ngid:   0
	Pid:    360237
	PPid:   7
	TracerPid:      0
	Uid:    501     501     501     501
	Gid:    501     501     501     501
	FDSize: 256
	Groups: 4 10 20 27 29 44 46 50 501 994 67278
	NStgid: 360237
	NSpid:  360237
	NSpgid: 360237
	NSsid:  360237
	Kthread:        0
	VmPeak:    11092 kB
	VmSize:    11092 kB
	VmLck:         0 kB
	VmPin:         0 kB
	VmHWM:      5004 kB
	VmRSS:      3824 kB
	RssAnon:            1448 kB
	RssFile:            2376 kB
	RssShmem:              0 kB
	VmData:     1540 kB
	VmStk:       132 kB
	VmExe:      1468 kB
	VmLib:      2072 kB
	VmPTE:        52 kB
	VmSwap:        0 kB
	CoreDumping:    0
	THP_enabled:    1
	untag_mask:     0xffffffffffffff
	Threads:        1
	SigQ:   0/64281
	SigPnd: 0000000000000000
	ShdPnd: 0000000000000000
	SigBlk: 0000000000000000
	SigIgn: 0000000000384004
	SigCgt: 000000004b813efb
	CapInh: 0000000000000000
	CapPrm: 0000000000000000
	CapEff: 0000000000000000
	CapBnd: 000001ffffffffff
	CapAmb: 0000000000000000
	NoNewPrivs:     0
	Seccomp:        0
	Seccomp_filters:        0
	Speculation_Store_Bypass:       vulnerable
	SpeculationIndirectBranch:      unknown
	Cpus_allowed:   1ff
	Cpus_allowed_list:      0-8
	Mems_allowed:   1
	Mems_allowed_list:      0
	voluntary_ctxt_switches:        87
	nonvoluntary_ctxt_switches:     36
	*/
	fields := make(map[string][]string)
	for line := range strings.SplitSeq(output.String(), "\n") {
		key, value, ok := strings.Cut(line, ":")
		if ok {
			fields[key] = strings.Fields(value)
		}
	}
	for _, key := range []string{"Uid", "Gid"} {
		values := fields[key]
		if len(values) != 4 {
			return fmt.Errorf("missing %s in process status", key)
		}
		for _, value := range values {
			if value != strconv.Itoa(submissionUID) {
				return fmt.Errorf("unexpected %s: %v", key, values)
			}
		}
	}
	if groups, ok := fields["Groups"]; !ok || len(groups) != 0 {
		return errors.New("submission process has supplementary groups")
	}
	for _, key := range []string{"CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"} {
		values := fields[key]
		if len(values) != 1 {
			return fmt.Errorf("missing %s in process status", key)
		}
		value, err := strconv.ParseUint(values[0], 16, 64)
		if err != nil || value != 0 {
			return fmt.Errorf("submission process has %s capabilities", key)
		}
	}
	if values := fields["NoNewPrivs"]; len(values) != 1 || values[0] != "1" {
		return errors.New("submission process is missing no_new_privs")
	}
	return nil
}
