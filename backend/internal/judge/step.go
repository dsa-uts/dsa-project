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
		Cmd:         []string{"stdbuf", "-oL", "-eL", "/bin/bash", "-e", "-o", "pipefail", "-c", step.Run},
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
	observed := stepObservation{peakMemory: baseline.bytes}
	var streams *stepIO
	stream, runErr := w.docker.ExecAttach(stepCtx, created.ID, client.ExecAttachOptions{})
	if runErr == nil {
		defer stream.Close()
		// A Step timeout first kills the process and drains its output. Only
		// Request cancellation closes the connection immediately.
		stopClosing := context.AfterFunc(ctx, stream.Close)
		defer stopClosing()
		streams = startStepIO(stream, step.Stdin, limits)
		result.ExitCode, observed, runErr = w.monitorStep(stepCtx, sb, created.ID, baseline, limits.Memory, streams)
	}
	elapsed := time.Since(execStartedAt)
	durationMS := elapsed.Milliseconds()
	result.DurationMS = &durationMS
	result.TLE = elapsed > step.Timeout
	cancel()

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

	var outputErr error
	if streams != nil {
		outputErr = streams.finish(finishCtx, sb.id, result.Index)
		result.Stdout = streams.stdout.result()
		result.Stderr = streams.stderr.result()
	}
	// Preserve a normally collected exit code. Interrupted Steps may have no
	// exit code yet; a known limit verdict does not depend on obtaining one.
	if result.ExitCode == exitCodeUnavailable {
		if final, err := w.inspectExec(finishCtx, created.ID); err == nil && final.PID != 0 && !final.Running {
			result.ExitCode = final.ExitCode
		}
	}

	finalErr := w.observeStepExit(finishCtx, sb, baseline, result.StartedAt, &observed)
	if runErr == nil {
		runErr = finalErr
	}
	result.MemoryBytes = &observed.peakMemory
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
	result.Status = judgeStep(step, result)
	return result, nil
}

func judgeStep(step resource.Step, result store.StepResult) store.Status {
	status := store.AC
	switch {
	case result.OLE:
		status = store.OLE
	case result.MLE:
		status = store.MLE
	case result.TLE:
		status = store.TLE
	case step.Expected.ExitCode != nil && result.ExitCode != *step.Expected.ExitCode:
		status = store.RE
	case !matchesExpectedOutput(result.Stdout.Data, step.Expected.Stdout):
		status = store.WA
	case !matchesExpectedOutput(result.Stderr.Data, step.Expected.Stderr):
		status = store.WA
	}
	if step.Compile && status != store.AC {
		return store.CE
	}
	return status
}

func matchesExpectedOutput(actual []byte, expected *resource.OutputExpectation) bool {
	if expected == nil {
		return true
	}
	mode := expected.Match
	switch mode {
	case resource.MatchExact, resource.MatchEasy, resource.MatchSorted:
	default:
		log.Printf("invalid output match mode %q; falling back to exact", mode)
		mode = resource.MatchExact
	}
	return resource.MatchOutput(actual, expected.Content, mode)
}
