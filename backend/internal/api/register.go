package api

import (
	"fmt"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/api/validation"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/labstack/echo/v4"
)

// Register assembles API handlers, authorization, and contract validation.
func Register(e *echo.Echo, authStore *store.AuthStore) {
	spec, err := generated.GetSpec()
	if err != nil {
		panic(fmt.Sprintf("load embedded openapi spec: %v", err))
	}
	// Deployment hosts are not part of request validation.
	spec.Servers = nil

	if err := httpauth.ValidateAccessPolicies(spec); err != nil {
		panic(fmt.Sprintf("invalid API access policy: %v", err))
	}
	validator := validation.RequestValidator(spec, httpauth.Authenticate(authStore))
	// Group middleware wraps every generated route, before generated parameter
	// binding. No operation ID list needs to track future endpoints.
	g := e.Group("", noStore, validator)
	generated.RegisterHandlers(g, generated.NewStrictHandler(newHandler(authStore), nil))
}

func noStore(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		c.Response().Header().Set("Cache-Control", "no-store")
		return next(c)
	}
}
