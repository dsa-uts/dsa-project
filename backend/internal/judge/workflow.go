package judge

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
	resource "github.com/dsa-uts/dsa-resource-spec"
)

func (w *worker) executeWorkflows(ctx context.Context, req *store.Request) ([]store.WorkflowResult, error) {
	if req == nil {
		return nil, fmt.Errorf("execute: req must not be nil")
	}

	if err := ctx.Err(); err != nil {
		return nil, err
	}

	if req.AttemptCount > 1 {
		// Local sandboxes were removed before claiming this Request.
		// Delete artifacts from previous attempts in the database.
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

		result, err := w.executeWorkflow(ctx, req, input, workflowID, workflows[workflowID])

		// 内部エラーでも、回収できた結果は最終試行の確定用に残す。
		if result != nil {
			results = append(results, *result)
		}
		if err != nil {
			return results, fmt.Errorf("execute workflow %s: %w", workflowID, err)
		}
		if result == nil {
			return results, fmt.Errorf("workflow %s returned no result", workflowID)
		}
	}
	return results, nil
}

func (w *worker) cleanupPreviousAttempts(ctx context.Context, req *store.Request) error {
	if req == nil {
		return fmt.Errorf("clean previous attempts: req must not be nil")
	}

	if req.AttemptCount <= 1 {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	if err := w.requests.DeletePreviousExecution(ctx, req.ID, w.ownerID, req.AttemptCount); err != nil {
		return fmt.Errorf("delete previous execution: %w", err)
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
	if req == nil || input == nil {
		return nil, fmt.Errorf("execute workflow: req and input must not be nil")
	}

	startedAt := time.Now()

	result = &store.WorkflowResult{
		RequestID:  req.ID,
		WorkflowID: workflowID,
		Details: store.WorkflowDetails{
			Jobs: []store.JobResult{},
		},
	}
	defer func() {
		result.DurationMS = time.Since(startedAt).Milliseconds()
		summarizeWorkflow(result, err)
	}()

	jobIDs, err := store.OrderedJobIDs(workflow, input.Submission.Kind)
	if err != nil {
		return result, err
	}

	for _, jobID := range jobIDs {
		if err := ctx.Err(); err != nil {
			return result, err
		}

		jobResult, executionErr := w.executeJob(ctx, req, input, workflowID, workflow, jobID)

		result.Details.Jobs = append(result.Details.Jobs, jobResult)

		if executionErr != nil {
			return result, fmt.Errorf("execute job %s: %w", jobID, executionErr)
		}
	}

	return result, nil
}

func summarizeWorkflow(result *store.WorkflowResult, executionErr error) {
	result.Status = store.AC
	// Job 開始前のエラーや Job 間のキャンセルも Workflow の IE とする。
	if executionErr != nil {
		result.Status = store.IE
	}
	// 打ち切り時も、最後の Job を含めて Status と Step の計測値を集計する。
	for _, job := range result.Details.Jobs {
		if job.Status.Rank() > result.Status.Rank() {
			result.Status = job.Status
		}
		for _, step := range job.Steps {
			if duration := step.DurationMS; duration != nil {
				if result.MaxStepDurationMS == nil || *duration > *result.MaxStepDurationMS {
					result.MaxStepDurationMS = duration
				}
			}
			if memory := step.MemoryBytes; memory != nil {
				if result.PeakMemoryBytes == nil || *memory > *result.PeakMemoryBytes {
					result.PeakMemoryBytes = memory
				}
			}
		}
	}
}
