package judge

import (
	"context"
	"errors"
	"fmt"
	"log"
	"maps"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
	resource "github.com/dsa-uts/dsa-resource-spec"
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

func Run(
	ctx context.Context,
	db *bun.DB,
	ownerID uuid.UUID,
	docker *client.Client,
) error {
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
		return fmt.Errorf("runRequest: req must be non-null.")
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

	state := store.CompletedState
	status := new(store.Status)
	*status = store.AC
	if executionErr != nil {
		*status = store.IE
		if !errors.Is(executionErr, errFilePlacement) && req.AttemptCount < 3 {
			state = store.RetryingState
			status = nil
		}

		log.Printf(
			"request %s attempt %d: %v",
			req.ID, req.AttemptCount, executionErr,
		)
	} else {
		// execute は正常終了後、対象 Workflow の全ての結果を返す。
		if len(results) == 0 {
			return errors.New("cannot complete request without workflow results")
		}
		for _, result := range results {
			rank := result.Status.Rank()
			if rank < 0 {
				return fmt.Errorf("invalid workflow status %q", result.Status)
			}
			if rank > status.Rank() {
				*status = result.Status
			}
		}
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
		state,
		status,
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
	if req == nil {
		return fmt.Errorf("maintain Lease: req must be non-null")
	}

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
	if req == nil {
		return nil, fmt.Errorf("execute: req must be non-null")
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
				"execute workflow %s: %w", workflowID, err,
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
	if req == nil {
		return fmt.Errorf("clean previous attempts: req must be non-null")
	}

	if req.AttemptCount <= 1 {
		return nil
	}
	deleteCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	if err := w.requests.DeletePreviousExecution(
		deleteCtx,
		req.ID,
		w.ownerID,
		req.AttemptCount,
	); err != nil {
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
		return nil, fmt.Errorf("execute workflow: req and input must be non-null")
	}

	startedAt := time.Now()

	result = &store.WorkflowResult{
		RequestID:  req.ID,
		WorkflowID: workflowID,
		Status:     store.AC,
		Details: store.WorkflowDetails{
			Jobs: []store.JobResult{},
		},
	}
	defer func() {
		result.DurationMS = time.Since(startedAt).Milliseconds()
		if err != nil {
			result.Status = store.IE
		}
		// 打ち切り時も、回収できた Step の計測値を集計する。
		for _, job := range result.Details.Jobs {
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
				"unresolvable job dependencies: %s",
				strings.Join(pending, ","),
			)
		}

		id := pending[ready]
		order = append(order, id)
		done[id] = true
		pending = slices.Delete(pending, ready, ready+1)
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
) (result store.JobResult, executionErr error) {
	result = store.JobResult{
		ID:        jobID,
		Status:    store.AC,
		StartedAt: time.Now(),
		Artifacts: []store.ArtifactResult{},
		Steps:     []store.StepResult{},
	}
	defer func() {
		result.FinishedAt = time.Now()
		if executionErr != nil {
			result.Status = store.IE
		}
	}()

	inputs, missing, err := w.loadJobArtifacts(ctx, req, workflowID, job)
	if err != nil {
		return result, err
	}
	if missing != "" {
		result.Status = store.SKIP
		result.SkipReason = missing
		return result, nil
	}
	ws, err := newWorkspace()
	if err != nil {
		return result, fmt.Errorf("prepare workspace: %w", err)
	}
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(ctx, removalTimeout)
		defer cancel()
		if err := w.releaseSandbox(cleanupCtx, ws); err != nil {
			// Recover leftovers before the next Request; keep the execution result.
			log.Printf("request %s job %s: cleanup sandbox: %v", req.ID, jobID, err)
		}
	}()
	if err := prepareJobFiles(ctx, ws, input, workflow, job, inputs); err != nil {
		return result, err
	}
	sb, err := w.startSandbox(ctx, req, ws, workflowID, jobID, job)
	if err != nil {
		return result, err
	}

	for index, step := range job.Steps {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		stepResult, stepErr := w.executeStep(ctx, sb, index, step, job.Limits)
		result.Steps = append(result.Steps, stepResult)
		if stepResult.Status.Rank() > result.Status.Rank() {
			result.Status = stepResult.Status
		}
		if stepErr != nil {
			return result, fmt.Errorf("execute step %s: %w", stepResult.ID, stepErr)
		}
		if stepResult.ContainerLost {
			result.StopReason = "OOM terminated the sandbox; remaining steps were not executed"
			break
		}
	}
	if err := w.stopSandbox(ctx, sb); err != nil {
		return result, fmt.Errorf("confirm sandbox stopped: %w", err)
	}
	if err := w.captureJobArtifacts(ctx, req, ws, workflowID, jobID, job, &result); err != nil {
		return result, err
	}
	return result, nil
}

type jobArtifactInput struct {
	path     string
	artifact *store.Artifact
}

func (w *worker) loadJobArtifacts(
	ctx context.Context,
	req *store.Request,
	workflowID string,
	job resource.Job,
) ([]jobArtifactInput, string, error) {
	if job.Artifacts == nil {
		return nil, "", nil
	}
	loadCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	inputs := make([]jobArtifactInput, 0, len(job.Artifacts.Inputs))

	for _, input := range job.Artifacts.Inputs {
		artifact, err := w.requests.LoadArtifact(
			loadCtx,
			req,
			workflowID,
			input.FromJob,
			input.Name,
		)
		if err != nil {
			return nil, "", fmt.Errorf("load input artifact %s/%s: %w",
				input.FromJob, input.Name, err)
		}
		if artifact == nil || artifact.Error != nil {
			reason := fmt.Sprintf("required artifact %s/%s is unavailable", input.FromJob, input.Name)
			return nil, reason, nil
		}
		inputs = append(
			inputs,
			jobArtifactInput{
				path:     string(input.Path),
				artifact: artifact,
			},
		)
	}
	return inputs, "", nil
}

func prepareJobFiles(
	ctx context.Context,
	ws *workspace,
	input *store.ExecutionInput,
	workflow resource.Workflow,
	job resource.Job,
	artifacts []jobArtifactInput,
) error {
	placementCtx, cancel := context.WithTimeout(ctx, placementTimeout)
	defer cancel()
	if err := ws.mount(placementCtx, job.Limits.WorkspaceSize); err != nil {
		return fmt.Errorf("mount workspace: %w", err)
	}
	place := func() error {
		if err := ws.placeSubmission(placementCtx, input.Files); err != nil {
			return err
		}
		for _, input := range artifacts {
			artifact := input.artifact
			if err := placeFile(placementCtx, ws.dataPath("workspace"), input.path, artifact.Content, artifact.Executable, true, submissionUID); err != nil {
				return fmt.Errorf("input artifact %q: %w", input.path, err)
			}
		}
		return ws.placePresets(placementCtx, workflow.Presets)
	}
	if err := place(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("%w: %w", errFilePlacement, err)
	}
	return nil
}

func (w *worker) captureJobArtifacts(
	ctx context.Context,
	req *store.Request,
	ws *workspace,
	workflowID, jobID string,
	job resource.Job,
	result *store.JobResult,
) error {
	if job.Artifacts == nil {
		return nil
	}
	captureCtx, cancel := context.WithTimeout(ctx, captureTimeout)
	defer cancel()
	for _, output := range job.Artifacts.Outputs {
		if err := captureCtx.Err(); err != nil {
			return err
		}
		artifact, captured, err := ws.captureArtifact(captureCtx, output, job.Limits.ArtifactSize)
		if err != nil {
			return fmt.Errorf("capture artifact %q: %w", output.Name, err)
		}
		if err := captureCtx.Err(); err != nil {
			return err
		}
		artifact.WorkflowID = workflowID
		artifact.JobID = jobID
		if err := w.requests.SaveArtifact(captureCtx, req, w.ownerID, artifact); err != nil {
			return fmt.Errorf("save artifact %q: %w", output.Name, err)
		}
		result.Artifacts = append(result.Artifacts, captured)
		if captured.Status.Rank() > result.Status.Rank() {
			result.Status = captured.Status
		}
	}
	return nil
}
