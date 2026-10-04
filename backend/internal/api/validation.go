package api

import (
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	echomiddleware "github.com/oapi-codegen/echo-middleware"
)

func init() {
	// kin-openapi does not enable UUID validation by default. Since v0.148.0,
	// registered validators also apply to OpenAPI 3.1. Register once,
	// before serving requests, to validate UUIDs in parameters and bodies.
	openapi3.DefineStringFormatValidator("uuid", openapi3.NewCallbackValidator(uuid.Validate))
}

func openAPIValidator(spec *openapi3.T, authenticate openapi3filter.AuthenticationFunc) echo.MiddlewareFunc {
	return echomiddleware.OapiRequestValidatorWithOptions(spec, &echomiddleware.Options{
		Options: openapi3filter.Options{AuthenticationFunc: authenticate},
	})
}

