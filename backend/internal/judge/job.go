package judge

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
	resource "github.com/dsa-uts/dsa-resource-spec"
)

func (w *worker) executeJob(
	ctx context.Context,
	req *store.Request,
	input *store.ExecutionInput,
	workflowID string,
	workflow resource.Workflow,
	jobID string,
) (result store.JobResult, executionErr error) {
	job := workflow.Jobs[jobID]
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
			return result, fmt.Errorf("execute step %d: %w", stepResult.Index, stepErr)
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
		artifact, err := w.requests.LoadArtifact(loadCtx, req, workflowID, input.FromJob, input.Name)
		if err != nil {
			return nil, "", fmt.Errorf("load input artifact %s/%s: %w",
				input.FromJob, input.Name, err)
		}
		if artifact == nil || artifact.Error != nil {
			reason := fmt.Sprintf("required artifact %s/%s is unavailable", input.FromJob, input.Name)
			return nil, reason, nil
		}
		inputs = append(inputs, jobArtifactInput{path: string(input.Path), artifact: artifact})
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
			if err := placeFile(
				placementCtx,
				ws.workspacePath(),
				input.path,
				artifact.Content,
				fileOptions{
					executable: artifact.Executable,
					replace:    true,
					uid:        submissionUID,
				}); err != nil {
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
	ws *workspace, workflowID, jobID string,
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
