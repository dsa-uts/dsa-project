package requests

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type Handler struct{ requests *store.RequestStore }

func NewHandler(requests *store.RequestStore) *Handler { return &Handler{requests: requests} }

var errFilesTooLarge = errors.New("File contents exceed 20,000,000 bytes.")

func (h *Handler) CreateValidation(ctx context.Context, req generated.CreateValidationRequestObject) (generated.CreateValidationResponseObject, error) {
	var submissionID *uuid.UUID
	var files []store.SubmissionFile
	var hash string

	if req.JSONBody != nil {
		submissionID = &req.JSONBody.SubmissionId
	} else if req.MultipartBody != nil {
		var err error
		files, hash, err = readUpload(req.MultipartBody)
		if errors.Is(err, errFilesTooLarge) {
			return nil, echo.NewHTTPError(http.StatusBadRequest, errFilesTooLarge.Error())
		}
		if err != nil {
			return nil, echo.NewHTTPError(http.StatusUnprocessableEntity, err.Error())
		}
	} else {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Request body is required.")
	}
	currentUser := httpauth.Actor(ctx)
	result, err := h.requests.CreateValidation(
		ctx,
		currentUser.ID,
		store.Role(currentUser.Role),
		req.ProjectId,
		submissionID,
		files,
		hash,
	)
	switch {
	case errors.Is(err, store.ErrNotFound):
		return nil, echo.NewHTTPError(http.StatusNotFound, "Project or Submission not found.")
	case errors.Is(err, store.ErrSubmissionOwner):
		return nil, echo.NewHTTPError(http.StatusForbidden, "Submission belongs to another user.")
	case errors.Is(err, store.ErrSubmissionScope):
		return nil, echo.NewHTTPError(http.StatusUnprocessableEntity, "Submission must belong to this Project and have kind validation.")
	case err != nil:
		return nil, fmt.Errorf("create validation: %w", err)
	}
	body := generated.CreatedRequest{
		Id:     result.ID,
		State:  generated.CreatedRequestState(result.State),
		Status: (*generated.NullableStatus)(result.Status),
	}
	return generated.CreateValidation201JSONResponse(body), nil
}

func (h *Handler) ListValidation(ctx context.Context, req generated.ListValidationRequestObject) (generated.ListValidationResponseObject, error) {
	params := req.Params
	// OpenAPI validates individual values; cross-parameter exclusions live here.
	if params.Next != nil && params.Prev != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Specify only one of next and prev.")
	}
	if params.Status != nil && params.State != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Specify only one of status and state.")
	}
	actor := httpauth.Actor(ctx)
	page, err := h.requests.ListValidation(ctx, actor.ID, store.Role(actor.Role), store.ValidationFilter{
		ProjectID: params.ProjectId, Status: (*store.Status)(params.Status),
		Incomplete: params.State != nil, Next: params.Next, Prev: params.Prev,
	})
	if errors.Is(err, store.ErrNotFound) {
		return nil, echo.NewHTTPError(http.StatusNotFound, "Project not found.")
	}
	if err != nil {
		return nil, fmt.Errorf("list validation: %w", err)
	}
	body := generated.ValidationPage{Requests: make([]generated.ValidationSummary, 0, len(page.Requests)), Next: page.Next, Prev: page.Prev}
	for _, row := range page.Requests {
		item := generated.ValidationSummary{
			Id: row.ID, Version: row.Version, State: generated.ValidationSummaryState(row.State),
			Status: (*generated.NullableStatus)(row.Status), ContentHash: "sha256:" + row.ContentHash,
			DurationMs: row.DurationMS, RequestedAt: row.RequestedAt,
		}
		item.Project.Id, item.Project.Name = row.ProjectID, row.ProjectName
		item.SubjectUser.Id, item.SubjectUser.Userid, item.SubjectUser.Name = row.SubjectUserID, row.Userid, row.UserName
		body.Requests = append(body.Requests, item)
	}
	return generated.ListValidation200JSONResponse(body), nil
}
