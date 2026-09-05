package api

import (
	"fmt"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/labstack/echo/v4"
)

// Register assembles API handlers, authorization, and contract validation.
func Register(e *echo.Echo, authStore *store.AuthStore) {
	spec, err := GetSpec()
	if err != nil {
		panic(fmt.Sprintf("load embedded openapi spec: %v", err))
	}
	// Deployment hosts are not part of request validation.
	spec.Servers = nil

	validator := requestValidator(spec)
	// Registration uses raw OpenAPI operationIds; the embedded spec contains
	// Go-normalized names, so it cannot supply these map keys.
	middlewares := map[string][]echo.MiddlewareFunc{
		"createSession":  {validator},
		"deleteSession":  {validator},
		"getCurrentUser": {validator},
	}
	for id, authorization := range userOperationMiddlewares(authStore) {
		middlewares[id] = append(authorization, validator)
	}

	g := e.Group("", noStore)
	RegisterHandlersWithOptions(g, NewStrictHandler(newHandler(authStore), nil), RegisterHandlersOptions{
		OperationMiddlewares: middlewares,
	})
}

func noStore(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		c.Response().Header().Set("Cache-Control", "no-store")
		return next(c)
	}
}
