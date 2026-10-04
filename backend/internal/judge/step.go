package judge

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
	resource "github.com/dsa-uts/dsa-resource-spec"
	"github.com/moby/moby/client"
)

const (
	exitCodeUnavailable = -1
	maxOutputBytes      = 128 << 10
	execPollInterval    = 10 * time.Millisecond
	stepTimeoutBuffer   = 200 * time.Millisecond
	stepFinishTimeout   = 3 * time.Second
)

// Callers read ExitCode only after a started exec reports Running=false.
func (w *worker) inspectExec(ctx context.Context, id string) (client.ExecInspectResult, error) {
	ctx, cancel := context.WithTimeout(ctx, apiTimeout)
	defer cancel()
	return w.docker.ExecInspect(ctx, id, client.ExecInspectOptions{})
}

func (w *worker) executeStep(ctx context.Context, sb *sandbox, index int, step resource.Step, limits resource.Limits) (result store.StepResult, executionErr error) {
	result = store.StepResult{
		Index:     index,
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
	// Allow slightly over-limit commands to finish so their duration is recorded.
	stepCtx, cancel := context.WithDeadline(ctx, execStartedAt.Add(step.Timeout).Add(stepTimeoutBuffer))
	defer cancel()
	stream, err := w.docker.ExecAttach(stepCtx, created.ID, client.ExecAttachOptions{})
	if err != nil {
		return result, fmt.Errorf("start step exec: %w", err)
	}
	defer stream.Close()
	// StdCopy does not observe ctx, so cancellation must close the connection
	// to unblock its reads. The deferred Close also runs on error; closing the
	// underlying network connection again (or concurrently) is safe.
	stopClosing := context.AfterFunc(stepCtx, stream.Close)
	defer stopClosing()

	streams := startStepIO(stream, step.Stdin, limits)
	observed, runErr := w.monitorStep(stepCtx, sb, created.ID, baseline, limits.Memory, streams)
	elapsed := time.Since(execStartedAt)
	durationMS := elapsed.Milliseconds()
	result.DurationMS = &durationMS

	// A lost exec connection does not kill its processes. Always try the UID
	// cleanup, including on success, before moving on to another Step.
	// Cleanup, output draining, and final observation share one time budget.
	// Request cancellation stops this work; a Step timeout alone does not.
	// Leftover sandboxes are reaped before the next claim.
	finishCtx, cancelFinish := context.WithTimeout(ctx, stepFinishTimeout)
	defer cancelFinish()
	if err := w.cleanupSubmission(finishCtx, sb); err != nil {
		log.Printf(
			"sandbox %s step %d: cleanup submission: %v",
			sb.id, result.Index, err,
		)
	}

	outputErr := streams.finish(finishCtx, sb.id, result.Index)
	result.Stdout = streams.stdout.result()
	result.Stderr = streams.stderr.result()

	finalErr := w.observeStepExit(finishCtx, sb, created.ID, baseline, result.StartedAt, &observed)
	if runErr == nil {
		runErr = finalErr
	}
	result.ExitCode = observed.exitCode
	result.MemoryBytes = &observed.peakMemory
	// Compare before millisecond truncation and before handling execution errors.
	result.TLE = elapsed > step.Timeout
	result.MLE = observed.mle
	result.OLE = result.Stdout.Truncated || result.Stderr.Truncated
	result.OOMKilled = observed.oomKilled
	result.ContainerLost = observed.containerLost
	switch {
	case ctx.Err() != nil:
		return result, ctx.Err()
	case result.TLE || result.MLE || result.OLE:
		// Stopping a Step can close its streams or remove its cgroup. These
		// errors and a missing exit code must not turn a limit verdict into IE.
	case runErr != nil:
		return result, runErr
	case outputErr != nil:
		return result, fmt.Errorf("read step output: %w", outputErr)
	case result.ExitCode == exitCodeUnavailable:
		return result, errors.New("step exit code unavailable")
	}
	result.Status, err = judgeStep(step, result)
	return result, err
}

func judgeStep(step resource.Step, result store.StepResult) (store.Status, error) {
	status := store.AC
	for _, check := range []struct {
		failed bool
		status store.Status
	}{
		{result.OLE, store.OLE},
		{result.MLE, store.MLE},
		{result.TLE, store.TLE},
		{step.Expected.ExitCode != nil && result.ExitCode != *step.Expected.ExitCode, store.RE},
	} {
		if check.failed && check.status.Rank() > status.Rank() {
			status = check.status
		}
	}
	if status == store.AC {
		for _, output := range []struct {
			actual   []byte
			expected *resource.OutputExpectation
		}{
			{result.Stdout.Data, step.Expected.Stdout},
			{result.Stderr.Data, step.Expected.Stderr},
		} {
			if output.expected == nil {
				continue
			}
			matched, err := resource.MatchOutput(output.actual, output.expected.Content, output.expected.Match)
			if err != nil {
				return store.IE, err
			}
			if !matched {
				status = store.WA
			}
		}
	}
	if step.Compile && status != store.AC {
		status = store.CE
	}
	return status, nil
}
