package sessions

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpresponse"
	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

// Handler implements session and current User Account operations.
type Handler struct{ auth *store.AuthStore }

func NewHandler(authStore *store.AuthStore) *Handler {
	return &Handler{auth: authStore}
}

var dummyPasswordHash = func() string {
	hash, err := auth.HashPassword("not-a-real-password")
	if err != nil {
		panic(err)
	}
	return hash
}()

func (h *Handler) CreateSession(ctx context.Context, req generated.CreateSessionRequestObject) (generated.CreateSessionResponseObject, error) {
	user, err := h.auth.FindUserForLogin(ctx, req.Body.Userid)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		slog.ErrorContext(ctx, "find user for login", "error", err)
		return generated.CreateSession500JSONResponse{InternalErrorJSONResponse: generated.InternalErrorJSONResponse(httpresponse.NewError("internal", "Failed to create session."))}, nil
	}
	loginCapable := err == nil && user.DisabledAt == nil && !user.IsSystem && user.PasswordHash != nil
	hash := dummyPasswordHash
	if loginCapable {
		hash = *user.PasswordHash
	}
	passwordOK := auth.VerifyPassword(hash, req.Body.Password)
	if !loginCapable || !passwordOK {
		return generated.CreateSession401JSONResponse{InvalidCredentialsJSONResponse: generated.InvalidCredentialsJSONResponse(httpresponse.NewError("invalid_credentials", "Invalid userid or password."))}, nil
	}
	now := time.Now()

	token, err := auth.NewToken()
	if err != nil {
		slog.ErrorContext(ctx, "generate session token", "error", err)
		return generated.CreateSession500JSONResponse{InternalErrorJSONResponse: generated.InternalErrorJSONResponse(httpresponse.NewError("internal", "Failed to create session."))}, nil
	}
	if err := h.auth.CreateSession(ctx, user, auth.HashToken(token), now, now.Add(auth.SessionLifetime*time.Second)); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return generated.CreateSession401JSONResponse{InvalidCredentialsJSONResponse: generated.InvalidCredentialsJSONResponse(httpresponse.NewError("invalid_credentials", "Invalid userid or password."))}, nil
		}
		slog.ErrorContext(ctx, "persist session", "error", err)
		return generated.CreateSession500JSONResponse{InternalErrorJSONResponse: generated.InternalErrorJSONResponse(httpresponse.NewError("internal", "Failed to create session."))}, nil
	}
	return generated.CreateSession200JSONResponse{
		Body:    userResponse(user),
		Headers: generated.CreateSession200ResponseHeaders{SetCookie: new(httpauth.SessionCookie(token))},
	}, nil
}

func (h *Handler) DeleteSession(ctx context.Context, req generated.DeleteSessionRequestObject) (generated.DeleteSessionResponseObject, error) {
	if req.Params.SessionToken != nil {
		if err := h.auth.DeleteSession(ctx, auth.HashToken(*req.Params.SessionToken)); err != nil {
			slog.ErrorContext(ctx, "delete session", "error", err)
			return generated.DeleteSession500JSONResponse{InternalErrorJSONResponse: generated.InternalErrorJSONResponse(httpresponse.NewError("internal", "Failed to delete session."))}, nil
		}
	}
	return generated.DeleteSession204Response{Headers: generated.DeleteSession204ResponseHeaders{SetCookie: new(httpauth.ClearedSessionCookie())}}, nil
}

func (h *Handler) GetCurrentUser(ctx context.Context, req generated.GetCurrentUserRequestObject) (generated.GetCurrentUserResponseObject, error) {
	return generated.GetCurrentUser200JSONResponse(userResponse(httpauth.Actor(ctx))), nil
}

func userResponse(user *store.UserAccount) generated.CurrentUser {
	return generated.CurrentUser{Id: user.ID, Userid: user.Userid, Name: user.Name, Role: generated.CurrentUserRole(user.Role)}
}
