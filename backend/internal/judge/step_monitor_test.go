package judge

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestMonitorStepCancellation(t *testing.T) {
	for _, parentCanceled := range []bool{false, true} {
		name := "step deadline stops monitoring without error"
		if parentCanceled {
			name = "request cancellation is an error"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			stepCtx, cancelStep := context.WithDeadline(ctx, time.Now().Add(-time.Second))
			defer cancelStep()
			if parentCanceled {
				cancel()
			}
			worker := &worker{}
			observed, err := worker.monitorStep(ctx, stepCtx, nil, "", memorySample{bytes: 123}, 1000, &stepIO{})
			if parentCanceled {
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("monitor = %+v, %v; want cancellation error", observed, err)
				}
			} else if err != nil {
				t.Fatalf("monitor = %+v, %v; want no error", observed, err)
			}
			if observed.peakMemory != 123 || observed.exitCode != exitCodeUnavailable {
				t.Errorf("initial measurements lost: %+v", observed)
			}
		})
	}
}
