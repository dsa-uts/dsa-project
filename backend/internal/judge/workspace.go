package judge

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
	resource "github.com/dsa-uts/dsa-resource-spec"
	"github.com/google/uuid"
)

const workspaceDirectory = "/var/lib/dsa-judge/workspaces"

type workspace struct {
	path string
}

func newWorkspace() (*workspace, error) {
	name := uuid.NewString()
	path := filepath.Join(workspaceDirectory, name)
	if err := os.Mkdir(path, 0700); err != nil {
		return nil, err
	}
	return &workspace{path: path}, nil
}

func (ws *workspace) dataPath(name string) string {
	return filepath.Join(ws.path, "data", name)
}

func (ws *workspace) mount(ctx context.Context, size int64) error {
	data := filepath.Join(ws.path, "data")
	if err := os.Mkdir(data, 0700); err != nil {
		return err
	}
	options := fmt.Sprintf("size=%d,noswap,nosuid,nodev,mode=0700", size)
	if err := filesystemCommand(ctx, "mount", "-t", "tmpfs", "-o", options, "tmpfs", data); err != nil {
		return err
	}
	for _, name := range []string{"workspace", "tmp", "shm"} {
		path := ws.dataPath(name)
		if err := os.Mkdir(path, 0755); err != nil {
			return err
		}
		if err := os.Chown(path, submissionUID, submissionUID); err != nil {
			return err
		}
	}
	return os.Mkdir(filepath.Join(ws.path, "preset"), 0755)
}

func filesystemCommand(ctx context.Context, command string, args ...string) error {
	output, err := exec.CommandContext(ctx, command, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %w: %s", command, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func (ws *workspace) remove(ctx context.Context) error {
	// Never remove files through a mounted tmpfs or a live Sandbox bind mount.
	data := filepath.Join(ws.path, "data")
	mounts, err := os.ReadFile("/proc/self/mountinfo")
	if err != nil {
		return err
	}
	for _, line := range strings.Split(string(mounts), "\n") {
		fields := strings.Fields(line)
		if len(fields) > 4 && fields[4] == data {
			if err := filesystemCommand(ctx, "umount", data); err != nil {
				return err
			}
			break
		}
	}
	return os.RemoveAll(ws.path)
}

func validFilePath(name string) bool {
	return name != "." && fs.ValidPath(name) && !strings.ContainsAny(name, "\\\x00:")
}

type fileOptions struct {
	executable bool
	replace    bool
	uid        int
}

// Placement happens before the Sandbox starts, so all existing entries were
// created by the Judge. Artifact inputs may replace submission files/directories.
func placeFile(ctx context.Context, root, name string, content []byte, options fileOptions) error {
	if !validFilePath(name) {
		return fmt.Errorf("invalid relative path %q", name)
	}
	parts := strings.Split(name, "/")
	parent := root
	for _, part := range parts[:len(parts)-1] {
		parent = filepath.Join(parent, part)
		info, err := os.Lstat(parent)
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		if err == nil && !info.IsDir() {
			if !options.replace {
				return fmt.Errorf("file blocks directory %q", parent)
			}
			if err := os.Remove(parent); err != nil {
				return err
			}
		}
		if err := os.MkdirAll(parent, 0755); err != nil {
			return err
		}
		if err := os.Chown(parent, options.uid, options.uid); err != nil {
			return err
		}
	}
	path := filepath.Join(root, filepath.FromSlash(name))
	if options.replace {
		if err := os.RemoveAll(path); err != nil {
			return err
		}
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer file.Close()

	for len(content) > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}
		chunk := content[:min(len(content), 64<<10)]
		n, err := file.Write(chunk)
		if err != nil {
			return err
		}
		if n != len(chunk) {
			return io.ErrShortWrite
		}
		content = content[n:]
	}
	if err := file.Chown(options.uid, options.uid); err != nil {
		return err
	}
	mode := fs.FileMode(0644)
	if options.executable {
		mode = 0755
	}
	if err := file.Chmod(mode); err != nil {
		return err
	}
	return file.Close()
}

func (ws *workspace) placeSubmission(ctx context.Context, files []store.SubmissionFile) error {
	for _, file := range files {
		if err := placeFile(ctx, ws.dataPath("workspace"), file.Path, file.Content, fileOptions{uid: submissionUID}); err != nil {
			return fmt.Errorf("submission file %q: %w", file.Path, err)
		}
	}
	return ctx.Err()
}

func (ws *workspace) placePresets(ctx context.Context, presets []resource.Preset) error {
	const maxPresetBytes = 64 << 20
	var total int64
	for _, preset := range presets {
		total += int64(len(preset.Content))
		if total > maxPresetBytes {
			return errors.New("preset files exceed 64 MiB")
		}
		if err := placeFile(ctx, filepath.Join(ws.path, "preset"), string(preset.Path), preset.Content, fileOptions{executable: preset.Executable}); err != nil {
			return fmt.Errorf("preset file %q: %w", preset.Path, err)
		}
	}
	return ctx.Err()
}

func (ws *workspace) captureArtifact(ctx context.Context, output resource.ArtifactOutput, limit int64) (store.Artifact, store.ArtifactResult, error) {
	artifact := store.Artifact{Name: output.Name}
	result := store.ArtifactResult{Name: output.Name, Path: string(output.Path), Status: store.AC}
	content, executable, err := readArtifact(ctx, ws.dataPath("workspace"), string(output.Path), limit)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) && !errors.Is(err, errArtifactInvalid) && !errors.Is(err, errArtifactTooLarge) {
			return artifact, result, err
		}
		result.Status = store.WA
		if errors.Is(err, errArtifactTooLarge) {
			result.Status = store.OLE
		}
		result.Error = err.Error()
		artifact.Error = &result.Error
		return artifact, result, nil
	}
	artifact.Content = content
	artifact.Executable = executable
	return artifact, result, nil
}

var errArtifactTooLarge = errors.New("artifact size limit exceeded")
var errArtifactInvalid = errors.New("invalid artifact")

func readArtifact(ctx context.Context, directory, name string, limit int64) ([]byte, bool, error) {
	if !validFilePath(name) {
		return nil, false, fmt.Errorf("%w: path %q", errArtifactInvalid, name)
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, false, err
	}
	defer root.Close()

	// os.Root confines traversal; Lstat also rejects in-root symlinks and FIFOs.
	parts := strings.Split(name, "/")
	for i := range parts {
		info, err := root.Lstat(strings.Join(parts[:i+1], "/"))
		if err != nil {
			return nil, false, err
		}
		if i < len(parts)-1 && !info.IsDir() {
			return nil, false, fmt.Errorf("%w: parent is not a directory", errArtifactInvalid)
		}
		if i == len(parts)-1 && !info.Mode().IsRegular() {
			return nil, false, fmt.Errorf("%w: not a regular file", errArtifactInvalid)
		}
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, false, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, false, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Nlink != 1 {
		return nil, false, fmt.Errorf("%w: hardlinks are not allowed", errArtifactInvalid)
	}
	if info.Size() > limit {
		return nil, false, errArtifactTooLarge
	}
	content, err := io.ReadAll(io.LimitReader(contextReader{ctx: ctx, reader: file}, limit+1))
	if err != nil {
		return nil, false, err
	}
	if int64(len(content)) > limit {
		return nil, false, errArtifactTooLarge
	}
	return content, info.Mode().Perm()&0111 != 0, nil
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(data []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(data)
}
