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
	peakMemory               int64
	mle                      bool
	oomKilled, containerLost bool
}

func (w *worker) monitorStep(ctx context.Context, sb *sandbox, execID string, baseline memorySample, softMemory int64, streams *stepIO) (int, stepObservation, error) {
	observed := stepObservation{peakMemory: baseline.bytes}
	inputDone, outputDone := streams.inputDone, streams.outputDone
	ticker := time.NewTicker(execPollInterval)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return exitCodeUnavailable, observed, err
		}
		sample, err := sampleMemory(sb)
		if err != nil {
			return exitCodeUnavailable, observed, fmt.Errorf("monitor memory: %w", err)
		}
		observed.peakMemory = max(observed.peakMemory, sample.bytes)
		observed.oomKilled = observed.oomKilled || sample.oomKills > baseline.oomKills
		observed.mle = observed.mle || observed.oomKilled || sample.bytes > softMemory
		if observed.mle {
			return exitCodeUnavailable, observed, nil
		}
		// I/O completion alone does not prove process exit. Inspect only after
		// both copies finish, and exclude Running=false before startup.
		if inputDone == nil && outputDone == nil {
			state, err := w.inspectExec(ctx, execID)
			if err != nil {
				return exitCodeUnavailable, observed, fmt.Errorf("inspect step exec: %w", err)
			}
			if !state.Running {
				return state.ExitCode, observed, nil
			}
		}
		select {
		case <-ctx.Done():
			return exitCodeUnavailable, observed, ctx.Err()
		case <-streams.overflow:
			return exitCodeUnavailable, observed, nil
		case <-inputDone:
			inputDone = nil
			// Programs may legitimately close stdin before consuming all input.
			if err := streams.inputErr; err != nil && !errors.Is(err, syscall.EPIPE) && !errors.Is(err, net.ErrClosed) {
				return exitCodeUnavailable, observed, fmt.Errorf("send step stdin: %w", err)
			}
		case <-outputDone:
			outputDone = nil
			if streams.outputErr != nil {
				return exitCodeUnavailable, observed, streams.outputErr
			}
		case <-ticker.C:
		}
	}
}

// observeStepExit checks for OOM even when the exec stream failed or was closed.
func (w *worker) observeStepExit(ctx context.Context, sb *sandbox, baseline memorySample, startedAt time.Time, observed *stepObservation) error {
	var observationErr error
	if sample, err := sampleMemory(sb); err == nil {
		observed.peakMemory = max(observed.peakMemory, sample.bytes)
		observed.oomKilled = observed.oomKilled || sample.oomKills > baseline.oomKills
	}
	if !observed.oomKilled {
		oom, err := w.sandboxOOM(ctx, sb, startedAt)
		if err != nil {
			observationErr = fmt.Errorf("check OOM events: %w", err)
		}
		observed.oomKilled = oom
	}
	observed.mle = observed.mle || observed.oomKilled
	state, err := w.inspectSandbox(ctx, sb.id)
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
