package api

import (
	"fmt"

	"github.com/dsa-uts/dsa-project/backend/internal/api/admin/users"
	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/sessions"
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

	validator := validation.RequestValidator(spec)
	// Registration uses raw OpenAPI operationIds; the embedded spec contains
	// Go-normalized names, so it cannot supply these map keys.
	middlewares := map[string][]echo.MiddlewareFunc{}
	for _, policy := range []map[string][]echo.MiddlewareFunc{
		sessions.OperationMiddlewares(),
		users.OperationMiddlewares(authStore),
	} {
		for id, authorization := range policy {
			middlewares[id] = append(authorization, validator)
		}
	}

	g := e.Group("", noStore)
	generated.RegisterHandlersWithOptions(g, generated.NewStrictHandler(newHandler(authStore), nil), generated.RegisterHandlersOptions{
		OperationMiddlewares: middlewares,
	})
}

func noStore(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		c.Response().Header().Set("Cache-Control", "no-store")
		return next(c)
	}
}
