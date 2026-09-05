package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/labstack/echo/v4"
)

type adminContextKey struct{}

// RequireAdmin runs before contract validation, so even invalid Admin requests
// receive 401/403 when the caller is not authorized.
func (h *Handler) RequireAdmin(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		switch c.Path() {
		case "/api/admin/users", "/api/admin/users/:user_id":
		default:
			return next(c)
		}
		cookie, err := c.Cookie(auth.SessionCookieName)
		if err != nil {
			c.Response().Header().Set("Set-Cookie", clearedSessionCookie())
			return c.JSON(http.StatusUnauthorized, NewError("unauthorized", "Authentication is required."))
		}
		user, err := h.auth.CurrentUser(c.Request().Context(), auth.HashToken(cookie.Value), time.Now())
		if errors.Is(err, store.ErrNotFound) {
			c.Response().Header().Set("Set-Cookie", clearedSessionCookie())
			return c.JSON(http.StatusUnauthorized, NewError("unauthorized", "Authentication is required."))
		}
		if err != nil {
			return err
		}
		if user.IsSystem || user.Role != "admin" {
			return c.JSON(http.StatusForbidden, NewError("forbidden", "Admin Role is required."))
		}
		c.SetRequest(c.Request().WithContext(context.WithValue(c.Request().Context(), adminContextKey{}, user)))
		return next(c)
	}
}

func adminUserResponse(user *store.UserAccount) AdminUser {
	return AdminUser{Id: user.ID, Userid: user.Userid, Name: user.Name, Role: UserRole(user.Role), Disabled: user.DisabledAt != nil}
}

func (h *Handler) ListAdminUsers(ctx context.Context, req ListAdminUsersRequestObject) (ListAdminUsersResponseObject, error) {
	users, err := h.auth.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]AdminUser, 0, len(users))
	for i := range users {
		result = append(result, adminUserResponse(&users[i]))
	}
	return ListAdminUsers200JSONResponse{Users: result}, nil
}

func (h *Handler) CreateAdminUser(ctx context.Context, req CreateAdminUserRequestObject) (CreateAdminUserResponseObject, error) {
	hash, err := auth.HashPassword(req.Body.Password)
	if err != nil {
		return nil, err
	}
	user := &store.UserAccount{Userid: req.Body.Userid, Name: req.Body.Name, Role: string(req.Body.Role), PasswordHash: &hash}
	if err := h.auth.CreateUser(ctx, user); errors.Is(err, store.ErrUseridTaken) {
		return CreateAdminUser409JSONResponse{UserConflictJSONResponse(NewError("userid_taken", "This User ID is already taken."))}, nil
	} else if err != nil {
		slog.ErrorContext(ctx, "create User Account", "error", err)
		return nil, err
	}
	return CreateAdminUser201JSONResponse(adminUserResponse(user)), nil
}

func (h *Handler) UpdateAdminUser(ctx context.Context, req UpdateAdminUserRequestObject) (UpdateAdminUserResponseObject, error) {
	actor := ctx.Value(adminContextKey{}).(*store.UserAccount)
	update := store.UserUpdate{Name: req.Body.Name, Disabled: req.Body.Disabled}
	if req.Body.Role != nil {
		role := string(*req.Body.Role)
		update.Role = &role
	}
	if req.Body.Password != nil {
		hash, err := auth.HashPassword(*req.Body.Password)
		if err != nil {
			return nil, err
		}
		update.PasswordHash = &hash
	}
	user, err := h.auth.UpdateUser(ctx, actor.ID, req.UserId, update)
	switch {
	case errors.Is(err, store.ErrNotFound):
		return UpdateAdminUser404JSONResponse{NotFoundJSONResponse(NewError("not_found", "User Account not found."))}, nil
	case errors.Is(err, store.ErrCannotModifySelf), errors.Is(err, store.ErrCannotModifySystemAccount):
		return UpdateAdminUser409JSONResponse{UserConflictJSONResponse(NewError(err.Error(), "This User Account cannot be modified in that way."))}, nil
	case err != nil:
		slog.ErrorContext(ctx, "update User Account", "error", err)
		return nil, err
	}
	return UpdateAdminUser200JSONResponse(adminUserResponse(user)), nil
}
