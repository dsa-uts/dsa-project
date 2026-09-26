package sessions

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/labstack/echo/v4"
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
		return nil, fmt.Errorf("find user for login: %w", err)
	}

	loginCapable := err == nil && user.DisabledAt == nil
	hash := dummyPasswordHash
	if loginCapable {
		hash = user.PasswordHash
	}
	passwordOK := auth.VerifyPassword(hash, req.Body.Password)
	if !loginCapable || !passwordOK {
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "Invalid userid or password.")
	}

	now := time.Now()
	token, err := auth.NewToken()
	if err != nil {
		return nil, fmt.Errorf("generate session token: %w", err)
	}

	if err := h.auth.CreateSession(ctx, user, auth.HashToken(token), now, now.Add(auth.SessionLifetime*time.Second)); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil, echo.NewHTTPError(http.StatusUnauthorized, "Invalid userid or password.")
		}
		return nil, fmt.Errorf("persist session: %w", err)
	}
	return generated.CreateSession200JSONResponse{
		Body: generated.CurrentUser{
			Id:     user.ID,
			Userid: user.Userid,
			Name:   user.Name,
			Role:   generated.CurrentUserRole(user.Role),
		},
		Headers: generated.CreateSession200ResponseHeaders{SetCookie: new(httpauth.SessionCookie(token))},
	}, nil
}

func (h *Handler) DeleteSession(ctx context.Context, req generated.DeleteSessionRequestObject) (generated.DeleteSessionResponseObject, error) {
	if req.Params.SessionToken != nil {
		if err := h.auth.DeleteSession(ctx, auth.HashToken(*req.Params.SessionToken)); err != nil {
			return nil, fmt.Errorf("delete session: %w", err)
		}
	}
	return generated.DeleteSession204Response{Headers: generated.DeleteSession204ResponseHeaders{SetCookie: new(httpauth.ClearedSessionCookie())}}, nil
}

func (h *Handler) GetCurrentUser(ctx context.Context, req generated.GetCurrentUserRequestObject) (generated.GetCurrentUserResponseObject, error) {
  userInfo := httpauth.Actor(ctx) 
	return generated.GetCurrentUser200JSONResponse{
		Id: userInfo.ID,
		Userid: userInfo.Userid,
		Name: userInfo.Name,
		Role: generated.CurrentUserRole(userInfo.Role),
	}, nil
}

