package judge

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
	resource "github.com/dsa-uts/dsa-resource-spec"
	"github.com/moby/moby/api/pkg/stdcopy"
	"github.com/moby/moby/client"
)

const (
	exitCodeUnavailable = -1
	maxOutputBytes      = 128 << 10
	execPollInterval    = 10 * time.Millisecond
)

// Callers read ExitCode only after a started exec reports Running=false.
func (w *worker) inspectExec(ctx context.Context, id string) (client.ExecInspectResult, error) {
	var result client.ExecInspectResult
	err := retryDocker(ctx, func(ctx context.Context) error {
		callCtx, cancel := context.WithTimeout(ctx, apiTimeout)
		defer cancel()
		var err error
		result, err = w.docker.ExecInspect(callCtx, id, client.ExecInspectOptions{})
		return err
	})
	return result, err
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
	for _, line := range strings.Split(string(events), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "oom_kill" {
			kills, err := strconv.ParseInt(fields[1], 10, 64)
			return memorySample{bytes: usage, oomKills: kills}, err
		}
	}
	return memorySample{}, errors.New("memory.events has no oom_kill counter")
}

type outputBuffer struct {
	data      bytes.Buffer
	limit     int
	truncated bool
	overflow  chan<- struct{}
	once      *sync.Once
}

func (b *outputBuffer) Write(data []byte) (int, error) {
	remaining := b.limit - b.data.Len()
	_, _ = b.data.Write(data[:min(len(data), remaining)])
	if len(data) > remaining {
		b.truncated = true
		b.once.Do(func() { b.overflow <- struct{}{} })
	}
	// Keep draining until the Judge kills the Step. Memory stays bounded even
	// when the stream contains a large frame or cleanup cannot start.
	return len(data), nil
}

func (b *outputBuffer) result() store.OutputResult {
	data := b.data.Bytes()
	if data == nil {
		data = []byte{}
	}
	return store.OutputResult{
		Data:      data,
		Truncated: b.truncated,
	}
}

func (w *worker) executeStep(
	ctx context.Context,
	sb *sandbox,
	index int,
	step resource.Step,
	limits resource.Limits,
) (result store.StepResult, executionErr error) {
	result = store.StepResult{
		ID:        strconv.Itoa(index),
		Status:    store.AC,
		StartedAt: time.Now(),
		ExitCode:  exitCodeUnavailable,
		Stdout:    store.OutputResult{Data: []byte{}},
		Stderr:    store.OutputResult{Data: []byte{}},
	}
	defer func() {
		result.FinishedAt = time.Now()
		if executionErr != nil {
			result.Status = store.IE
		}
	}()
	if step.Timeout <= 0 {
		return result, errors.New("step timeout must be positive")
	}
	baseline, err := sampleMemory(sb)
	if err != nil {
		return result, fmt.Errorf("read initial memory: %w", err)
	}
	peakMemory := baseline.bytes
	result.MemoryBytes = &peakMemory
	createCtx, cancelCreate := context.WithTimeout(ctx, apiTimeout)
	created, err := w.docker.ExecCreate(createCtx, sb.id, client.ExecCreateOptions{
		User: submissionUser, WorkingDir: "/workspace",
		Cmd:         []string{"/bin/bash", "-e", "-o", "pipefail", "-c", step.Run},
		AttachStdin: true, AttachStdout: true, AttachStderr: true,
	})
	cancelCreate()
	if err != nil {
		return result, fmt.Errorf("create step exec: %w", err)
	}

	// ExecAttach starts the command. Use the same start for duration and TLE.
	execStartedAt := time.Now()
	stepCtx, cancel := context.WithDeadline(ctx, execStartedAt.Add(step.Timeout))
	defer cancel()
	stream, err := w.docker.ExecAttach(stepCtx, created.ID, client.ExecAttachOptions{})
	if err != nil {
		return result, fmt.Errorf("start step exec: %w", err)
	}
	defer stream.Close()
	stopClosing := context.AfterFunc(stepCtx, stream.Close)
	defer stopClosing()

	overflow := make(chan struct{}, 1)
	once := new(sync.Once)
	stdout := &outputBuffer{limit: int(min(limits.StdoutSize, maxOutputBytes)), overflow: overflow, once: once}
	stderr := &outputBuffer{limit: int(min(limits.StderrSize, maxOutputBytes)), overflow: overflow, once: once}
	inputDone := make(chan error, 1)
	inputStopped := make(chan struct{})
	outputDone := make(chan error, 1)
	go func() {
		defer close(inputStopped)
		_, err := io.Copy(stream.Conn, bytes.NewReader(step.Stdin))
		if err == nil {
			err = stream.CloseWrite()
		}
		inputDone <- err
	}()
	go func() {
		_, err := stdcopy.StdCopy(stdout, stderr, stream.Reader)
		outputDone <- err
	}()

	outputFinished, outputErr, runErr := w.monitorStep(
		ctx, stepCtx, sb, created.ID, baseline, limits.Memory,
		&result, overflow, inputDone, outputDone,
	)
	durationMS := time.Since(execStartedAt).Milliseconds()
	result.DurationMS = &durationMS

	// A lost exec connection does not kill its processes. Always try the UID
	// cleanup, including on success, before moving on to another Step.
	cleanupCtx, cancelCleanup := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
	if err := w.cleanupSubmission(cleanupCtx, sb); err != nil {
		log.Printf(
			"sandbox %s step %s: cleanup submission: %v",
			sb.id, result.ID, err,
		)
	}
	cancelCleanup()

	if !outputFinished {
		drainCtx, cancelDrain := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
		select {
		case outputErr = <-outputDone:
		case <-drainCtx.Done():
			stream.Close()
			<-outputDone
			outputErr = nil
			log.Printf(
				"sandbox %s step %s: output stream did not close after UID cleanup",
				sb.id, result.ID,
			)
		}
		cancelDrain()
	}
	stream.Close()
	<-inputStopped
	// Closing the connection releases a blocked stdin writer as well.
	// Its error after our cleanup does not invalidate an already completed exec.

	result.Stdout = stdout.result()
	result.Stderr = stderr.result()
	result.OLE = result.OLE || stdout.truncated || stderr.truncated

	finalCtx, cancelFinal := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
	defer cancelFinal()
	if final, err := w.inspectExec(finalCtx, created.ID); err == nil && !final.Running {
		result.ExitCode = final.ExitCode
	}
	if sample, err := sampleMemory(sb); err == nil {
		*result.MemoryBytes = max(*result.MemoryBytes, sample.bytes)
		result.OOMKilled = result.OOMKilled || sample.oomKills > baseline.oomKills
	}
	if !result.OOMKilled {
		oom, err := w.sandboxOOM(finalCtx, sb, result.StartedAt)
		if err != nil && runErr == nil {
			runErr = fmt.Errorf("check OOM events: %w", err)
		}
		result.OOMKilled = oom
	}
	result.MLE = result.MLE || result.OOMKilled
	state, err := w.inspectSandbox(finalCtx, sb.id)
	if err != nil {
		if runErr == nil {
			runErr = fmt.Errorf("inspect sandbox after step: %w", err)
		}
	} else {
		result.ContainerLost = state.State == nil || !state.State.Running
		if result.ContainerLost && !result.OOMKilled && runErr == nil {
			runErr = errors.New("sandbox exited without an OOM event")
		}
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if !result.TLE && !result.MLE && !result.OLE {
		if runErr != nil {
			return result, runErr
		}
		if outputErr != nil {
			return result, fmt.Errorf("read step output: %w", outputErr)
		}
		if result.ExitCode == exitCodeUnavailable {
			return result, errors.New("step exit code unavailable")
		}
	}
	result.Status, err = judgeStep(step, result, stdout.data.Bytes(), stderr.data.Bytes())
	return result, err
}

func (w *worker) monitorStep(
	ctx, stepCtx context.Context,
	sb *sandbox,
	execID string,
	baseline memorySample,
	softMemory int64,
	result *store.StepResult,
	overflow <-chan struct{},
	inputDone, outputDone <-chan error,
) (outputFinished bool, outputErr, executionErr error) {
	ticker := time.NewTicker(execPollInterval)
	defer ticker.Stop()
	nextMemory := time.Now()
	for {
		if err := stepCtx.Err(); err != nil {
			if ctx.Err() != nil {
				return outputFinished, outputErr, ctx.Err()
			}
			result.TLE = true
			return outputFinished, outputErr, nil
		}
		if !time.Now().Before(nextMemory) {
			sample, err := sampleMemory(sb)
			if err != nil {
				return outputFinished, outputErr, fmt.Errorf("monitor memory: %w", err)
			}
			*result.MemoryBytes = max(*result.MemoryBytes, sample.bytes)
			result.OOMKilled = sample.oomKills > baseline.oomKills
			result.MLE = result.OOMKilled || sample.bytes > softMemory
			if result.MLE {
				return outputFinished, outputErr, nil
			}
			nextMemory = time.Now().Add(memoryInterval)
		}
		state, err := w.inspectExec(stepCtx, execID)
		if err != nil {
			if stepCtx.Err() != nil {
				continue
			}
			return outputFinished, outputErr, fmt.Errorf("inspect step exec: %w", err)
		}
		if !state.Running {
			result.ExitCode = state.ExitCode
			return outputFinished, outputErr, nil
		}
		select {
		case <-stepCtx.Done():
		case <-overflow:
			result.OLE = true
			return outputFinished, outputErr, nil
		case err := <-inputDone:
			inputDone = nil
			// Programs may legitimately close stdin before consuming all input.
			if err != nil && !errors.Is(err, syscall.EPIPE) && !errors.Is(err, net.ErrClosed) {
				return outputFinished, outputErr, fmt.Errorf("send step stdin: %w", err)
			}
		case outputErr = <-outputDone:
			outputFinished = true
			outputDone = nil
			if outputErr != nil {
				if stepCtx.Err() != nil && ctx.Err() == nil {
					result.TLE = true
					return outputFinished, outputErr, nil
				}
				return outputFinished, outputErr, outputErr
			}
		case <-ticker.C:
		}
	}
}

func judgeStep(step resource.Step, result store.StepResult, stdout, stderr []byte) (store.Status, error) {
	status := store.AC
	switch {
	case result.OLE:
		status = store.OLE
	case result.MLE:
		status = store.MLE
	case result.TLE:
		status = store.TLE
	default:
		if expected := step.Expected.ExitCode; expected != nil && result.ExitCode != *expected {
			status = store.RE
		}
		for _, output := range []struct {
			actual   []byte
			expected *resource.OutputExpectation
		}{
			{stdout, step.Expected.Stdout},
			{stderr, step.Expected.Stderr},
		} {
			if output.expected == nil {
				continue
			}
			matched, err := resource.MatchOutput(output.actual, output.expected.Content, output.expected.Match)
			if err != nil {
				return store.IE, err
			}
			if !matched && status.Rank() < store.WA.Rank() {
				status = store.WA
			}
		}
	}
	if step.Compile && status != store.AC {
		status = store.CE
	}
	return status, nil
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
	fields := make(map[string][]string)
	for _, line := range strings.Split(output.String(), "\n") {
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
