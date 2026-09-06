package httpauth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/api/httpresponse"
	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/labstack/echo/v4"
	echomiddleware "github.com/oapi-codegen/echo-middleware"
)

type actorContextKey struct{}

// Authenticate runs during security validation, before parameters and bodies.
// ValidateAccessPolicies must have accepted the spec before registering routes.
func Authenticate(authStore *store.AuthStore) openapi3filter.AuthenticationFunc {
	return func(ctx context.Context, input *openapi3filter.AuthenticationInput) error {
		c := echomiddleware.GetEchoContext(ctx)
		if c == nil || input.SecuritySchemeName != "sessionAuth" {
			return echo.NewHTTPError(http.StatusInternalServerError, "Invalid API access policy.")
		}
		unauthorized := func() error {
			c.Response().Header().Set("Set-Cookie", ClearedSessionCookie())
			return echo.NewHTTPError(http.StatusUnauthorized, "Authentication is required.")
		}
		cookie, err := c.Cookie(auth.SessionCookieName)
		if err != nil {
			return unauthorized()
		}
		// echo-middleware supplies a background context to this callback. Use the
		// original request for DB cancellation and install the actor there for strict handlers.
		requestContext := c.Request().Context()
		user, err := authStore.CurrentUser(requestContext, auth.HashToken(cookie.Value), time.Now())
		if errors.Is(err, store.ErrNotFound) {
			return unauthorized()
		}
		if err != nil {
			slog.ErrorContext(requestContext, "authenticate session", "error", err)
			// The middleware preserves direct HTTP errors in SecurityRequirementsError.
			// Wrapping this error would turn a database failure into a 403.
			if len(input.Scopes) == 0 {
				// Preserve the current-user lookup's existing error envelope.
				return echo.NewHTTPError(http.StatusInternalServerError,
					httpresponse.NewError("internal", "Failed to get current user.")).SetInternal(err)
			}
			return echo.NewHTTPError(http.StatusInternalServerError, "Internal server error.").SetInternal(err)
		}
		// kin-openapi passes the required Roles through its Scopes field.
		// Every Role in this requirement must match; the validator handles OR.
		for _, role := range input.Scopes {
			if user.IsSystem || user.Role != role {
				label := role
				if role == "admin" {
					label = "Admin"
				}
				return echo.NewHTTPError(http.StatusForbidden, fmt.Sprintf("%s Role is required.", label))
			}
		}
		c.SetRequest(c.Request().WithContext(context.WithValue(requestContext, actorContextKey{}, user)))
		return nil
	}
}

// Actor returns the User Account installed by successful security validation.
func Actor(ctx context.Context) *store.UserAccount {
	return ctx.Value(actorContextKey{}).(*store.UserAccount)
}
