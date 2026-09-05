package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/labstack/echo/v4"
)

type adminContextKey struct{}

// requireAdmin runs before contract validation, so even invalid Admin requests
// receive 401/403 when the caller is not authorized.
func requireAdmin(authStore *store.AuthStore) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			cookie, err := c.Cookie(auth.SessionCookieName)
			if err != nil {
				c.Response().Header().Set("Set-Cookie", clearedSessionCookie())
				return c.JSON(http.StatusUnauthorized, NewError("unauthorized", "Authentication is required."))
			}
			user, err := authStore.CurrentUser(c.Request().Context(), auth.HashToken(cookie.Value), time.Now())
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
}

// adminActor reads the actor installed by requireAdmin before validation.
func adminActor(ctx context.Context) *store.UserAccount {
	return ctx.Value(adminContextKey{}).(*store.UserAccount)
}
