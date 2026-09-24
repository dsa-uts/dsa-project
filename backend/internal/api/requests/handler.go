package requests

import (
	"context"
	"errors"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpresponse"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/google/uuid"
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
			return generated.CreateValidation413JSONResponse(httpresponse.NewError("payload_too_large", err.Error())), nil
		}
		if err != nil {
			return invalid(err.Error()), nil
		}
	} else {
		return invalid("Request body is required."), nil
	}
	result, created, err := h.requests.CreateValidation(ctx, httpauth.Actor(ctx), req.ProjectId, req.Params.IdempotencyKey.String(), submissionID, files, hash)
	switch {
	case errors.Is(err, store.ErrNotFound):
		return generated.CreateValidation404JSONResponse(httpresponse.NewError("not_found", "Project or Submission not found.")), nil
	case errors.Is(err, store.ErrSubmissionOwner):
		return generated.CreateValidation403JSONResponse(httpresponse.NewError("forbidden", "Submission belongs to another user.")), nil
	case errors.Is(err, store.ErrSubmissionScope):
		return invalid("Submission must belong to this Project and have kind validation."), nil
	case errors.Is(err, store.ErrIdempotencyConflict):
		return generated.CreateValidation409JSONResponse(httpresponse.NewError("idempotency_key_conflict", "Key already used for another Project or kind.")), nil
	case err != nil:
		return nil, err
	}
	body := generated.CreatedRequest{Id: result.ID, State: generated.CreatedRequestState(result.State), Status: (*generated.NullableStatus)(result.Status)}
	if created {
		return generated.CreateValidation201JSONResponse(body), nil
	}
	return generated.CreateValidation200JSONResponse(body), nil
}

func invalid(message string) generated.CreateValidation422JSONResponse {
	return generated.CreateValidation422JSONResponse{ValidationErrorJSONResponse: generated.ValidationErrorJSONResponse(httpresponse.NewError("validation_failed", message))}
}
