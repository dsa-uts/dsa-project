// Package server assembles the Echo instance: routes, validator, middleware.
package server

import (
	"net/http"

	"github.com/go-playground/validator/v10"
	echo "github.com/labstack/echo/v4"

	"github.com/dsa-uts/dsa-project/backend/internal/handler"
)

// structValidator adapts go-playground/validator to echo.Validator.
// docs/spec/api.md: バリデーション失敗は 422、エラーは {"error":{"code","message"}} 封筒。
type structValidator struct {
	validate *validator.Validate
}

func (v *structValidator) Validate(i any) error {
	if err := v.validate.Struct(i); err != nil {
		return echo.NewHTTPError(http.StatusUnprocessableEntity, echo.Map{
			"error": echo.Map{
				"code":    "validation_failed",
				"message": err.Error(),
			},
		})
	}
	return nil
}

// New builds the Echo instance with all routes registered.
func New() *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.Validator = &structValidator{validate: validator.New()}

	e.GET("/health", handler.Health)

	api := e.Group("/api")
	api.GET("/hello", handler.HelloGet)
	api.POST("/hello", handler.HelloPost)

	return e
}
