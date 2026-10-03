package judge

import (
	"context"
	"errors"
	"fmt"
	"net"
	"syscall"
	"time"
)

// stepObservation contains measurements only; executeStep builds the stored result.
type stepObservation struct {
	exitCode                 int
	peakMemory               int64
	tle, mle, ole            bool
	oomKilled, containerLost bool
}

func (w *worker) monitorStep(ctx, stepCtx context.Context, sb *sandbox, execID string, baseline memorySample, softMemory int64, streams *stepIO) (stepObservation, error) {
	observed := stepObservation{exitCode: exitCodeUnavailable, peakMemory: baseline.bytes}
	inputDone, outputDone := streams.inputDone, streams.outputDone
	ticker := time.NewTicker(execPollInterval)
	defer ticker.Stop()
	nextMemory := time.Now()
	for {
		if err := stepCtx.Err(); err != nil {
			if ctx.Err() != nil {
				return observed, ctx.Err()
			}
			observed.tle = true
			return observed, nil
		}
		if !time.Now().Before(nextMemory) {
			sample, err := sampleMemory(sb)
			if err != nil {
				return observed, fmt.Errorf("monitor memory: %w", err)
			}
			observed.peakMemory = max(observed.peakMemory, sample.bytes)
			observed.oomKilled = sample.oomKills > baseline.oomKills
			observed.mle = observed.oomKilled || sample.bytes > softMemory
			if observed.mle {
				return observed, nil
			}
			nextMemory = time.Now().Add(memoryInterval)
		}
		state, err := w.inspectExec(stepCtx, execID)
		if err != nil {
			if stepCtx.Err() != nil {
				continue
			}
			return observed, fmt.Errorf("inspect step exec: %w", err)
		}
		if !state.Running {
			observed.exitCode = state.ExitCode
			return observed, nil
		}
		select {
		case <-stepCtx.Done():
		case <-streams.overflow:
			observed.ole = true
			return observed, nil
		case err := <-inputDone:
			inputDone = nil
			// Programs may legitimately close stdin before consuming all input.
			if err != nil && !errors.Is(err, syscall.EPIPE) && !errors.Is(err, net.ErrClosed) {
				return observed, fmt.Errorf("send step stdin: %w", err)
			}
		case streams.outputErr = <-outputDone:
			streams.outputFinished = true
			outputDone = nil
			if streams.outputErr != nil {
				if stepCtx.Err() != nil && ctx.Err() == nil {
					observed.tle = true
					return observed, nil
				}
				return observed, streams.outputErr
			}
		case <-ticker.C:
		}
	}
}

// observeStepExit checks for OOM even when the exec stream failed or was closed.
func (w *worker) observeStepExit(ctx context.Context, sb *sandbox, execID string, baseline memorySample, startedAt time.Time, observed *stepObservation) error {
	var observationErr error
	finalCtx, cancelFinal := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
	defer cancelFinal()
	if final, err := w.inspectExec(finalCtx, execID); err == nil && !final.Running {
		observed.exitCode = final.ExitCode
	}
	if sample, err := sampleMemory(sb); err == nil {
		observed.peakMemory = max(observed.peakMemory, sample.bytes)
		observed.oomKilled = observed.oomKilled || sample.oomKills > baseline.oomKills
	}
	if !observed.oomKilled {
		oom, err := w.sandboxOOM(finalCtx, sb, startedAt)
		if err != nil && observationErr == nil {
			observationErr = fmt.Errorf("check OOM events: %w", err)
		}
		observed.oomKilled = oom
	}
	observed.mle = observed.mle || observed.oomKilled
	state, err := w.inspectSandbox(finalCtx, sb.id)
	if err != nil {
		if observationErr == nil {
			observationErr = fmt.Errorf("inspect sandbox after step: %w", err)
		}
	} else {
		observed.containerLost = state.State == nil || !state.State.Running
		if observed.containerLost && !observed.oomKilled && observationErr == nil {
			observationErr = errors.New("sandbox exited without an OOM event")
		}
	}

	return observationErr
}
