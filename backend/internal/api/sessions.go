package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

type sessionHandler struct{ auth *store.AuthStore }

var dummyPasswordHash = func() string {
	hash, err := auth.HashPassword("not-a-real-password")
	if err != nil {
		panic(err)
	}
	return hash
}()

func (h *sessionHandler) CreateSession(ctx context.Context, req CreateSessionRequestObject) (CreateSessionResponseObject, error) {
	user, err := h.auth.FindUserForLogin(ctx, req.Body.Userid)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		slog.ErrorContext(ctx, "find user for login", "error", err)
		return CreateSession500JSONResponse{InternalErrorJSONResponse(NewError("internal", "Failed to create session."))}, nil
	}
	loginCapable := err == nil && user.DisabledAt == nil && !user.IsSystem && user.PasswordHash != nil
	hash := dummyPasswordHash
	if loginCapable {
		hash = *user.PasswordHash
	}
	passwordOK := auth.VerifyPassword(hash, req.Body.Password)
	if !loginCapable || !passwordOK {
		return CreateSession401JSONResponse{InvalidCredentialsJSONResponse(NewError("invalid_credentials", "Invalid userid or password."))}, nil
	}
	now := time.Now()

	token, err := auth.NewToken()
	if err != nil {
		slog.ErrorContext(ctx, "generate session token", "error", err)
		return CreateSession500JSONResponse{InternalErrorJSONResponse(NewError("internal", "Failed to create session."))}, nil
	}
	if err := h.auth.CreateSession(ctx, user, auth.HashToken(token), now, now.Add(auth.SessionLifetime*time.Second)); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return CreateSession401JSONResponse{InvalidCredentialsJSONResponse(NewError("invalid_credentials", "Invalid userid or password."))}, nil
		}
		slog.ErrorContext(ctx, "persist session", "error", err)
		return CreateSession500JSONResponse{InternalErrorJSONResponse(NewError("internal", "Failed to create session."))}, nil
	}
	cookie := sessionCookie(token)
	return CreateSession200JSONResponse{
		Body:    userResponse(user),
		Headers: CreateSession200ResponseHeaders{SetCookie: &cookie},
	}, nil
}

func (h *sessionHandler) DeleteSession(ctx context.Context, req DeleteSessionRequestObject) (DeleteSessionResponseObject, error) {
	if req.Params.SessionToken != nil {
		if err := h.auth.DeleteSession(ctx, auth.HashToken(*req.Params.SessionToken)); err != nil {
			slog.ErrorContext(ctx, "delete session", "error", err)
			return DeleteSession500JSONResponse{InternalErrorJSONResponse(NewError("internal", "Failed to delete session."))}, nil
		}
	}
	cookie := clearedSessionCookie()
	return DeleteSession204Response{Headers: DeleteSession204ResponseHeaders{SetCookie: &cookie}}, nil
}

func (h *sessionHandler) GetCurrentUser(ctx context.Context, req GetCurrentUserRequestObject) (GetCurrentUserResponseObject, error) {
	if req.Params.SessionToken == nil {
		return unauthorizedCurrentUser(), nil
	}
	user, err := h.auth.CurrentUser(ctx, auth.HashToken(*req.Params.SessionToken), time.Now())
	if errors.Is(err, store.ErrNotFound) {
		return unauthorizedCurrentUser(), nil
	}
	if err != nil {
		slog.ErrorContext(ctx, "get current user", "error", err)
		return GetCurrentUser500JSONResponse{InternalErrorJSONResponse(NewError("internal", "Failed to get current user."))}, nil
	}
	return GetCurrentUser200JSONResponse(userResponse(user)), nil
}

func unauthorizedCurrentUser() GetCurrentUser401JSONResponse {
	cookie := clearedSessionCookie()
	return GetCurrentUser401JSONResponse{UnauthorizedJSONResponse{
		Body:    NewError("unauthorized", "Authentication is required."),
		Headers: UnauthorizedResponseHeaders{SetCookie: &cookie},
	}}
}

func userResponse(user *store.UserAccount) CurrentUser {
	return CurrentUser{Id: user.ID, Userid: user.Userid, Name: user.Name, Role: CurrentUserRole(user.Role)}
}

func sessionCookie(token string) string {
	return fmt.Sprintf("%s=%s; Path=/; Max-Age=%d; HttpOnly; Secure; SameSite=Lax", auth.SessionCookieName, token, auth.SessionLifetime)
}

func clearedSessionCookie() string {
	return fmt.Sprintf("%s=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax", auth.SessionCookieName)
}
