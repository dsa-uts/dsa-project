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
