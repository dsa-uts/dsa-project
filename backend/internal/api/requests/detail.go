package requests

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	resource "github.com/dsa-uts/dsa-resource-spec"
	"github.com/labstack/echo/v4"
)

func (h *Handler) GetValidation(ctx context.Context, req generated.GetValidationRequestObject) (generated.GetValidationResponseObject, error) {
	actor := httpauth.Actor(ctx)
	detail, err := h.requests.GetValidation(ctx, req.RequestId, actor.ID, store.Role(actor.Role))
	if err != nil {
		return nil, validationReadError(err)
	}
	body, err := validationDetail(detail)
	if err != nil {
		return nil, fmt.Errorf("build validation detail: %w", err)
	}
	return generated.GetValidation200JSONResponse(body), nil
}

func validationReadError(err error) error {
	switch {
	case errors.Is(err, store.ErrNotFound):
		return echo.NewHTTPError(http.StatusNotFound, "Request not found.")
	case errors.Is(err, store.ErrRequestNotCompleted):
		return echo.NewHTTPError(http.StatusConflict, "Request has not completed.")
	default:
		return fmt.Errorf("read validation: %w", err)
	}
}

func validationDetail(detail store.ValidationDetail) (generated.ValidationDetail, error) {
	body := generated.ValidationDetail{
		Id:           detail.ID,
		SubmissionId: detail.SubmissionID,
		Version:      detail.Version,
		State:        generated.ValidationDetailState(detail.State),
		Status:       (*generated.NullableStatus)(detail.Status),
		ContentHash:  "sha256:" + detail.ContentHash,
		RequestedAt:  detail.RequestedAt,
		DurationMs:   detail.DurationMS,
	}
	body.Project.Id, body.Project.Name = detail.ProjectID, detail.ProjectName
	body.SubjectUser.Id, body.SubjectUser.Userid, body.SubjectUser.Name = detail.SubjectUserID, detail.Userid, detail.UserName
	if detail.State != store.CompletedState {
		return body, nil
	}
	body.Result = &generated.ValidationResult{
		Workflows: []generated.ValidationWorkflow{},
	}
	results := make(map[string]store.WorkflowResult, len(detail.Results))
	for _, result := range detail.Results {
		results[result.WorkflowID] = result
	}
	for _, id := range slices.Sorted(maps.Keys(detail.Resource.Workflows)) {
		definition := detail.Resource.Workflows[id]
		workflow := generated.ValidationWorkflow{
			Id:   id,
			Name: definition.Name,
			Jobs: []generated.ValidationJob{},
		}
		saved, exists := results[id]
		if exists {
			workflow.Status = new(generated.NullableStatus(saved.Status))
			workflow.DurationMs = &saved.DurationMS
		}
		jobs := make(map[string]store.JobResult, len(saved.Details.Jobs))
		for _, job := range saved.Details.Jobs {
			jobs[job.ID] = job
		}
		order, err := store.OrderedJobIDs(definition, store.ValidationKind)
		if err != nil {
			return body, err
		}
		for _, jobID := range order {
			jobResult, exists := jobs[jobID]
			job := validationJob(definition.Jobs[jobID], jobResult, exists)
			job.Id = jobID
			job.Artifacts = validationArtifacts(id, jobID, definition.Jobs[jobID], jobResult, detail.Artifacts)
			body.Result.PeakMemoryBytes = maximumMeasurement(body.Result.PeakMemoryBytes, job.PeakMemoryBytes)
			workflow.Jobs = append(workflow.Jobs, job)
		}
		body.Result.Workflows = append(body.Result.Workflows, workflow)
	}
	return body, nil
}

func validationJob(definition resource.Job, saved store.JobResult, exists bool) generated.ValidationJob {
	job := generated.ValidationJob{
		Name:      definition.Name,
		Steps:     []generated.ValidationStep{},
		Artifacts: []generated.ValidationArtifact{},
	}
	if exists {
		job.Status = new(generated.NullableStatus(saved.Status))
		job.DurationMs = new(
			max(
				int64(0),
				saved.FinishedAt.Sub(saved.StartedAt).Milliseconds(),
			),
		)
		if saved.SkipReason != "" {
			job.SkipReason = new("A required input Artifact is unavailable.")
		}
		if saved.StopReason != "" {
			job.StopReason = new("The Sandbox was lost; remaining Step results are unavailable.")
		}
	}
	steps := make(map[int]store.StepResult, len(saved.Steps))
	for _, step := range saved.Steps {
		steps[step.Index] = step
	}
	for index, definition := range definition.Steps {
		step := generated.ValidationStep{
			Index:     index,
			Name:      definition.Name,
			Run:       definition.Run,
			Compile:   definition.Compile,
			TimeoutMs: definition.Timeout.Milliseconds(),
			Stdin:     base64.StdEncoding.EncodeToString(definition.Stdin),
			Expected: generated.StepExpectation{
				ExitCode: definition.Expected.ExitCode,
				Stdout:   expectedOutput(definition.Expected.Stdout),
				Stderr:   expectedOutput(definition.Expected.Stderr),
			},
		}
		if result, ok := steps[index]; exists && ok {
			step.Status = new(generated.NullableStatus(result.Status))
			step.DurationMs, step.MemoryBytes = result.DurationMS, result.MemoryBytes
			if result.ExitCode >= 0 {
				step.ExitCode = &result.ExitCode
			}
			step.Stdout = &generated.StepOutput{
				Data:      base64.StdEncoding.EncodeToString(result.Stdout.Data),
				Truncated: result.Stdout.Truncated,
			}
			step.Stderr = &generated.StepOutput{
				Data:      base64.StdEncoding.EncodeToString(result.Stderr.Data),
				Truncated: result.Stderr.Truncated,
			}
			job.PeakMemoryBytes = maximumMeasurement(job.PeakMemoryBytes, result.MemoryBytes)
		}
		job.Steps = append(job.Steps, step)
	}
	return job
}

func expectedOutput(output *resource.OutputExpectation) *generated.ExpectedOutput {
	if output == nil {
		return nil
	}
	return &generated.ExpectedOutput{Data: base64.StdEncoding.EncodeToString(output.Content), Match: generated.ExpectedOutputMatch(output.Match)}
}

func maximumMeasurement(a, b *int64) *int64 {
	if a == nil || (b != nil && *b > *a) {
		return b
	}
	return a
}

func validationArtifacts(workflowID, jobID string, definition resource.Job, saved store.JobResult, metadata []store.ArtifactMetadata) []generated.ValidationArtifact {
	artifacts := []generated.ValidationArtifact{}
	if definition.Artifacts == nil {
		return artifacts
	}
	for _, output := range definition.Artifacts.Outputs {
		if output.Visibility != "public" {
			continue
		}
		item := generated.ValidationArtifact{Name: output.Name, Path: string(output.Path), ContentType: output.ContentType}
		for _, result := range saved.Artifacts {
			if result.Name == output.Name {
				item.Status = new(generated.ValidationArtifactStatus(result.Status))
			}
		}
		for _, file := range metadata {
			if file.WorkflowID == workflowID && file.JobID == jobID && file.Name == output.Name {
				item.Available = file.Error == nil && file.SizeBytes != nil
				if item.Available {
					item.SizeBytes = file.SizeBytes
				} else if file.Error != nil {
					item.Error = new("Artifact capture failed.")
					if item.Status != nil && *item.Status == generated.ValidationArtifactStatus(store.OLE) {
						item.Error = new("Artifact exceeds the size limit.")
					}
				}
			}
		}
		artifacts = append(artifacts, item)
	}
	return artifacts
}
