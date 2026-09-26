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
			return generated.CreateValidation400JSONResponse{Code: &httpresponse.ValidationErrorCode, Message: err.Error()}, nil
		}
		if err != nil {
			return generated.CreateValidation422JSONResponse{Code: &httpresponse.ValidationErrorCode, Message: err.Error()}, nil
		}
	} else {
		return generated.CreateValidation400JSONResponse{Code: &httpresponse.ValidationErrorCode, Message: "Request body is required."}, nil
	}
	result, err := h.requests.CreateValidation(ctx, httpauth.Actor(ctx), req.ProjectId, submissionID, files, hash)
	switch {
	case errors.Is(err, store.ErrNotFound):
		return generated.CreateValidation404JSONResponse{Code: &httpresponse.NotFoundErrorCode, Message: "Project or Submission not found."}, nil
	case errors.Is(err, store.ErrSubmissionOwner):
		return generated.CreateValidation403JSONResponse{Code: &httpresponse.ForbiddenErrorCode, Message: "Submission belongs to another user."}, nil
	case errors.Is(err, store.ErrSubmissionScope):
		return generated.CreateValidation422JSONResponse{Code: &httpresponse.ValidationErrorCode, Message: "Submission must belong to this Project and have kind validation."}, nil
	case err != nil:
		return nil, err
	}
	body := generated.CreatedRequest{Id: result.ID, State: generated.CreatedRequestState(result.State), Status: (*generated.NullableStatus)(result.Status)}
	return generated.CreateValidation201JSONResponse(body), nil
}
