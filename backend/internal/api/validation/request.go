package validation

import (
	"fmt"
	"net/http"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpresponse"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	echomiddleware "github.com/oapi-codegen/echo-middleware"
)

func init() {
	// kin-openapi does not enable UUID validation by default. Register once,
	// before serving requests, so invalid path parameters produce 422 here
	// instead of 400 from generated UUID binding after this middleware.
	openapi3.DefineStringFormatValidator("uuid", openapi3.NewCallbackValidator(uuid.Validate))
}

func RequestValidator(spec *openapi3.T, authenticate openapi3filter.AuthenticationFunc) echo.MiddlewareFunc {
	// openapi.yaml の required / minLength 等をリクエスト受理前に強制する
	// (ADR 0010: kin-openapi による validation は spec から従属的に得られる)。
	return echomiddleware.OapiRequestValidatorWithOptions(spec, &echomiddleware.Options{
		Options: openapi3filter.Options{AuthenticationFunc: authenticate},
		ErrorHandler: func(c echo.Context, err *echo.HTTPError) error {
			if body, ok := err.Message.(generated.Error); ok {
				return c.JSON(err.Code, body)
			}
			// middleware はリクエスト不正を 400 で返すが、docs/spec/api.md では
			// バリデーション失敗は 422 + 統一エラー封筒。404 / 405 等はそのまま
			// httpErrorHandler に流して封筒化する。
			if err.Code == http.StatusBadRequest {
				return c.JSON(http.StatusUnprocessableEntity, httpresponse.NewError("validation_failed", fmt.Sprint(err.Message)))
			}
			return err
		},
	})
}
