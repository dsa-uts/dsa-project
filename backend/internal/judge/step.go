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
	stepCtx, cancel := context.WithDeadline(ctx, execStartedAt.Add(step.Timeout))
	defer cancel()
	stream, err := w.docker.ExecAttach(stepCtx, created.ID, client.ExecAttachOptions{})
	if err != nil {
		return result, fmt.Errorf("start step exec: %w", err)
	}
	defer stream.Close()
	stopClosing := context.AfterFunc(stepCtx, stream.Close)
	defer stopClosing()

	streams := startStepIO(stream, step.Stdin, limits)
	observed, runErr := w.monitorStep(ctx, stepCtx, sb, created.ID, baseline, limits.Memory, streams)
	durationMS := time.Since(execStartedAt).Milliseconds()
	result.DurationMS = &durationMS

	// A lost exec connection does not kill its processes. Always try the UID
	// cleanup, including on success, before moving on to another Step.
	cleanupCtx, cancelCleanup := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
	if err := w.cleanupSubmission(cleanupCtx, sb); err != nil {
		log.Printf(
			"sandbox %s step %d: cleanup submission: %v",
			sb.id, result.Index, err,
		)
	}
	cancelCleanup()

	outputErr := streams.finish(ctx, sb.id, result.Index)
	result.Stdout = streams.stdout.result()
	result.Stderr = streams.stderr.result()
	observed.ole = observed.ole || result.Stdout.Truncated || result.Stderr.Truncated

	finalErr := w.observeStepExit(ctx, sb, created.ID, baseline, result.StartedAt, &observed)
	if runErr == nil {
		runErr = finalErr
	}
	result.ExitCode = observed.exitCode
	result.MemoryBytes = &observed.peakMemory
	result.TLE = observed.tle
	result.MLE = observed.mle
	result.OLE = observed.ole
	result.OOMKilled = observed.oomKilled
	result.ContainerLost = observed.containerLost
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
	result.Status, err = judgeStep(step, result)
	return result, err
}

func judgeStep(step resource.Step, result store.StepResult) (store.Status, error) {
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
