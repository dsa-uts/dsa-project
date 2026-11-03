package httpauth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/api/httpresponse"
	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/google/uuid"
)

type actorContextKey struct{}

type UserInfo struct {
	ID     uuid.UUID
	Userid string
	Name   string
	Role   auth.Role
}

// Authenticate runs during security validation, before parameters and bodies.
// ValidateAccessPolicies must have accepted the spec before registering routes.
func Authenticate(
	accountStore *store.AccountStore,
	w http.ResponseWriter,
) openapi3filter.AuthenticationFunc {
	return func(ctx context.Context, input *openapi3filter.AuthenticationInput) error {
		r := input.RequestValidationInput.Request
		if input.SecuritySchemeName != "sessionAuth" {
			return fmt.Errorf("invalid API access policy: %s", input.SecuritySchemeName)
		}
		unauthorized := func() error {
			w.Header().Set("Set-Cookie", ClearedSessionCookie())
			return &httpresponse.Error{
				Code:    http.StatusUnauthorized,
				Message: "Authentication is required.",
			}
		}
		cookie, err := r.Cookie(auth.SessionCookieName)
		if err != nil {
			return unauthorized()
		}
		user, err := accountStore.CurrentUser(
			ctx,
			auth.HashToken(cookie.Value),
			time.Now(),
		)
		if errors.Is(err, store.ErrNotFound) {
			return unauthorized()
		}
		if err != nil {
			return fmt.Errorf("authenticate session: %w", err)
		}
		// kin-openapi passes the required Roles through its Scopes field.
		// Startup validation permits at most one minimum Role.
		actualRole := auth.Role(user.Role)
		for _, scope := range input.Scopes {
			requiredRole := auth.Role(scope)
			if !auth.AllowsRole(actualRole, requiredRole) {
				return &httpresponse.Error{
					Code:    http.StatusForbidden,
					Message: fmt.Sprintf("%s Role is required.", requiredRole),
				}
			}
		}
		*r = *r.WithContext(context.WithValue(ctx, actorContextKey{}, UserInfo{
			ID:     user.ID,
			Userid: user.Userid,
			Name:   user.Name,
			Role:   actualRole,
		}))
		return nil
	}
}

// Actor returns the User Account installed by successful security validation.
func Actor(ctx context.Context) UserInfo {
	return ctx.Value(actorContextKey{}).(UserInfo)
}
