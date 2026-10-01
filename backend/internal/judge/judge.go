package judge

import (
	"context"
	"errors"
	"fmt"
	"log"
	"maps"
	"slices"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
	resource "github.com/dsa-uts/dsa-resource-spec"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type worker struct {
	requests *store.RequestStore
	ownerID  uuid.UUID
}

func Run(
	ctx context.Context,
	db *bun.DB,
	ownerID uuid.UUID,
) error {
	w := &worker{
		requests: store.NewRequestStore(db),
		ownerID:  ownerID,
	}

	for {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("claim request: %w", err)
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
	results, executionErr := w.execute(runCtx, req)

	// 完了更新とlease更新が競合しないよう、更新ループを終了させる
	stopLease()
	leaseErr := <-leaseDone

	if err := ctx.Err(); err != nil {
		return err
	}

	if errors.Is(leaseErr, store.ErrLeaseLost) {
		log.Printf("requeset %s: lease lost", req.ID)
		return nil
	}
	if leaseErr != nil {
		return fmt.Errorf("maintain lease: %w", leaseErr)
	}

	if executionErr != nil {
		log.Printf(
			"request %s attempt %d: %v",
			req.ID, req.AttemptCount, executionErr,
		)
	}

	// Artifactのアップロード等は完了済み。
	// ここでは短いDBトランザクションだけを実行する
	saveCtx, cancelSave := context.WithTimeout(ctx, 10*time.Second)
	defer cancelSave()

	err := w.requests.FinishAttempt(
		saveCtx,
		req.ID,
		w.ownerID,
		req.AttemptCount,
		results,
		executionErr,
	)
	if errors.Is(err, store.ErrLeaseLost) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("finish attempt: %w", err)
	}
	return nil
}

func (w *worker) maintainLease(
	ctx context.Context,
	req *store.Request,
) error {
	for {
		if err := wait(ctx, 10*time.Second); err != nil {
			return err
		}

		updateCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := w.requests.RenewLease(
			updateCtx,
			req.ID,
			w.ownerID,
			req.AttemptCount,
		)
		cancel()

		if err != nil {
			return err
		}
	}
}

func (w *worker) execute(
	ctx context.Context,
	req *store.Request,
) ([]store.WorkflowResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	if req.AttemptCount > 1 {
		// 旧試行のSandboxを削除し、旧試行のArtifactをDBから削除する
		if err := w.cleanupPreviousAttempts(ctx, req); err != nil {
			return nil, fmt.Errorf("cleanup previous attempts: %w", err)
		}
	}

	input, err := w.requests.LoadExecutionInput(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("load execution input: %w", err)
	}

	workflows := input.Version.ResourceJSON.Workflows
	results := make([]store.WorkflowResult, 0, len(workflows))

	for _, workflowID := range slices.Sorted(maps.Keys(workflows)) {
		if err := ctx.Err(); err != nil {
			return results, err
		}

		result, err := w.executeWorkflow(
			ctx,
			req,
			input,
			workflowID,
			workflows[workflowID],
		)

		// 内部エラーでも、回収できた結果は最終試行の確定用に残す。
		if result != nil {
			results = append(results, *result)
		}
		if err != nil {
			return results, fmt.Errorf(
				"execute workflow %s: %w", &workflowID, err,
			)
		}
		if result == nil {
			return results, fmt.Errorf(
				"workflow %s returned no result", workflowID,
			)
		}
	}
	return results, nil
}

func (w *worker) cleanupPreviousAttempts(
	ctx context.Context,
	req *store.Request,
) error {
	if req.AttemptCount <= 1 {
		return nil
	}

	// 旧試行のSandboxが削除されたことを確認するまで戻らない
	if err := w.deletePreviousSandboxes(ctx, req); err != nil {
		return fmt.Errorf("delete previous sandboxes: %w", err)
	}

	deleteCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	if err := w.requests.DeletePreviousArtifacts(
		deleteCtx,
		req.ID,
		w.ownerID,
		req.AttemptCount,
	); err != nil {
		return fmt.Errorf("delete previous artifacts: %w", err)
	}

	return nil
}

func (w *worker) executeWorkflow(
	ctx context.Context,
	req *store.Request,
	input *store.ExecutionInput,
	workflowID string,
	workflow resource.Workflow,
) (result *store.WorkflowResult, err error) {
	startedAt := time.Now()

	result = &store.WorkflowResult{
		RequestID: req.ID,
		WorkflowID: workflowID,
		Status: store.AC,
		Details: store.WorkflowDetails{
			Jobs: []store.JobResult{},
		},
	}
	defer func() {
		result.DurationMS = time.Since(startedAt).Milliseconds()
		if err != nil {
			result.Status = store.IE
		}
	}()

	jobsIDs, err := orderedJobIDs(workflow, input.Submission.Kind)
	if err != nil {
		return result, err
	}

	for _, jobID := range jobsIDs {
		if err := ctx.Err(); err != nil {
			return result, err
		}

		jobResult, executionErr := w.executeJob(
			ctx,
			req,
			input,
			workflowID,
			workflow,
			jobID,
			workflow.Jobs[jobID],
		)
		jobResult.ID = jobID

		if executionErr == nil && jobResult.Status.Rank() < 0 {
			executionErr = fmt.Errorf(
				"invalid job status %q", jobResult.Status,
			)
		}
		if executionErr != nil {
			jobResult.Status = store.IE
		}

		result.Details.Jobs = append(result.Details.Jobs, jobResult)

		if executionErr != nil {
			return result, fmt.Errorf(
				"execute job %s: %w", jobID, executionErr,
			)
		}

		if jobResult.Status.Rank() > result.Status.Rank() {
			result.Status = jobResult.Status
		}
	}

	return result, nil
}

func orderedJobIDs(
	workflow resource.Workflow,
	kind store.SubmissionKind,
) ([]string, error) {
  if kind != store.ValidationKind && kind != store.EvaluationKind {
		return nil, fmt.Errorf("unknown submission kind %q", kind)
	}

	pending := slices.Sorted(maps.Keys(workflow.Jobs))
	if kind == store.ValidationKind {
		pending = slices.DeleteFunc(pending, func(id string) bool {
			return workflow.Jobs[id].Visibility != "public"
		})
	}

	order := make([]string, 0, len(pending))
	done := make(map[string]bool, len(pending))

	for len(pending) > 0 {
		ready := -1
		for i, id := range pending {
			if slices.ContainsFunc(workflow.Jobs[id].Depends, func(dep string) bool {
				return !done[dep]
			}) {
				continue
			}
			ready = i
			break
		}

		if ready < 0 {
			return nil, fmt.Errorf(
				"unresolvable job dependencies: %w", pending,
			)
		}

		id := pending[ready]
		order = append(order, id)
		done[id] = true
		pending = slices.Delete(pending, ready, ready + 1)
	}

	return order, nil
}

func (w *worker) executeJob(
	ctx context.Context,
	req *store.Request,
	input *store.ExecutionInput,
	workflowID string,
	workflow resource.Workflow,
	jobID string,
	job resource.Job,
) (store.JobResult, error) {
	return store.JobResult{}, nil
}
