package api

import (
	"fmt"
	"mime"
	"net/http"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/api/validation"
	"github.com/dsa-uts/dsa-project/backend/internal/resourceimport"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/labstack/echo/v4"
)

// Register assembles API handlers, authorization, and contract validation.
func Register(e *echo.Echo, authStore *store.AuthStore, projectStore *store.ProjectStore, requestStore *store.RequestStore, source *resourceimport.Source) {
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
	g := e.Group("", noStore, prepareRequest, validator)
	generated.RegisterHandlers(g, generated.NewStrictHandler(newHandler(authStore, projectStore, requestStore, source), nil))
}

func noStore(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		c.Response().Header().Set("Cache-Control", "no-store")
		return next(c)
	}
}

// Prepare the transport without rejecting input before authentication.
func prepareRequest(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		r := c.Request()
		if r.Method == http.MethodPost && c.Path() == "/api/projects/:project_id/validation" {
			r.Body = http.MaxBytesReader(c.Response(), r.Body, 21_000_000)
		}
		// Generated multi-body dispatch expects canonical media type casing.
		if media, params, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err == nil {
			r.Header.Set("Content-Type", mime.FormatMediaType(media, params))
		}
		return next(c)
	}
}
