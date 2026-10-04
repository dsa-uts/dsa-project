package judge

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestMonitorStepCancellation(t *testing.T) {
	for _, parentCanceled := range []bool{false, true} {
		name := "step deadline is returned"
		if parentCanceled {
			name = "request cancellation is an error"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			deadline := time.Now().Add(-time.Second)
			wantErr := context.DeadlineExceeded
			if parentCanceled {
				cancel()
				deadline = time.Now().Add(time.Hour)
				wantErr = context.Canceled
			}
			stepCtx, cancelStep := context.WithDeadline(ctx, deadline)
			defer cancelStep()
			worker := &worker{}
			exitCode, observed, err := worker.monitorStep(stepCtx, nil, "", memorySample{bytes: 123}, 1000, &stepIO{})
			if !errors.Is(err, wantErr) {
				t.Fatalf("monitor = %+v, %v; want %v", observed, err, wantErr)
			}
			if observed.peakMemory != 123 {
				t.Errorf("initial measurements lost: %+v", observed)
			}
			if exitCode != exitCodeUnavailable {
				t.Errorf("exit code = %d, want %d", exitCode, exitCodeUnavailable)
			}
		})
	}
}
