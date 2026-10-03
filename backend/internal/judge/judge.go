package judge

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/google/uuid"
	"github.com/moby/moby/client"
	"github.com/uptrace/bun"
)

var errFilePlacement = errors.New("sandbox file placement failed")

type worker struct {
	requests *store.RequestStore
	ownerID  uuid.UUID
	docker   *client.Client
}

// Run processes requests serially until cancellation or an unrecoverable error.
// The Docker client must connect to the dedicated judge daemon: recovery removes
// all of its containers before claiming the next request.
func Run(ctx context.Context, db *bun.DB, ownerID uuid.UUID, docker *client.Client) error {
	w := &worker{
		requests: store.NewRequestStore(db),
		ownerID:  ownerID,
		docker:   docker,
	}
	if err := os.MkdirAll(workspaceDirectory, 0700); err != nil {
		return fmt.Errorf("create workspace directory: %w", err)
	}
	if err := os.Chmod(workspaceDirectory, 0700); err != nil {
		return err
	}
	for {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("claim request: %w", err)
		}

		// Also recovers resources at startup, before the first claim.
		if err := w.reapSandboxes(ctx); err != nil {
			return fmt.Errorf("recover local sandboxes: %w", err)
		}

		req, err := w.requests.ClaimNext(ctx, w.ownerID)
		if err != nil {
			return fmt.Errorf("claim request: %w", err)
		}

		if req == nil {
			if err := wait(ctx, time.Second); err != nil {
				return err
			}
			continue
		}

		// 実行しきった分だけDBに保存する。
		// sandboxコンテナやワークスペースの掃除ができていなくてもerrには反映しない。
		// そうした異常状態はこの前のreapSandboxesで拾う。
		if err := w.runRequest(ctx, req); err != nil {
			return fmt.Errorf("run request %s: %w", req.ID, err)
		}
	}
}

func wait(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (w *worker) runRequest(ctx context.Context, req *store.Request) error {
	if req == nil {
		return fmt.Errorf("runRequest: req must not be nil")
	}

	runCtx, cancelRun := context.WithCancelCause(ctx)
	defer cancelRun(nil)

	leaseCtx, stopLease := context.WithCancel(runCtx)
	defer stopLease()

	leaseDone := make(chan error, 1)
	go func() {
		err := w.maintainLease(leaseCtx, req)

		// 明示的な停止・プロセス終了はlease更新失敗にしない
		if leaseCtx.Err() != nil {
			err = nil
		}
		if err != nil {
			cancelRun(err)
		}
		leaseDone <- err
	}()

	// 入力検証、旧試行の後始末、Workflow実行、Artifact保存
	results, executionErr := w.executeWorkflows(runCtx, req)

	// 完了更新とlease更新が競合しないよう、更新ループを終了させる
	stopLease()
	leaseErr := <-leaseDone

	if err := ctx.Err(); err != nil {
		return err
	}

	if errors.Is(leaseErr, store.ErrLeaseLost) {
		log.Printf("request %s: lease lost", req.ID)
		return nil
	}
	if leaseErr != nil {
		return fmt.Errorf("maintain lease: %w", leaseErr)
	}

	if executionErr != nil {
		log.Printf("request %s attempt %d: %v", req.ID, req.AttemptCount, executionErr)
	}
	state, status, err := attemptOutcome(req.AttemptCount, results, executionErr)
	if err != nil {
		return err
	}

	// Artifactのアップロード等は完了済み。
	// ここでは短いDBトランザクションだけを実行する
	saveCtx, cancelSave := context.WithTimeout(ctx, 10*time.Second)
	defer cancelSave()

	err = w.requests.FinishAttempt(saveCtx, req.ID, w.ownerID, req.AttemptCount, results, state, status)
	if errors.Is(err, store.ErrLeaseLost) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("finish attempt: %w", err)
	}
	return nil
}

func (w *worker) maintainLease(ctx context.Context, req *store.Request) error {
	if req == nil {
		return fmt.Errorf("maintain lease: req must not be nil")
	}

	for {
		if err := wait(ctx, 10*time.Second); err != nil {
			return err
		}

		updateCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := w.requests.RenewLease(updateCtx, req.ID, w.ownerID, req.AttemptCount)
		cancel()

		if err != nil {
			return err
		}
	}
}

// attemptOutcome decides whether to retry and which status to save on completion.
func attemptOutcome(attempt int32, results []store.WorkflowResult, executionErr error) (store.RequestState, *store.Status, error) {
	if executionErr != nil {
		if !errors.Is(executionErr, errFilePlacement) && attempt < 3 {
			return store.RetryingState, nil, nil
		}
		status := store.IE
		return store.CompletedState, &status, nil
	}
	if len(results) == 0 {
		return "", nil, errors.New("cannot complete request without workflow results")
	}
	status := store.AC
	for _, result := range results {
		if result.Status.Rank() < 0 {
			return "", nil, fmt.Errorf("invalid workflow status %q", result.Status)
		}
		if result.Status.Rank() > status.Rank() {
			status = result.Status
		}
	}
	return store.CompletedState, &status, nil
}
