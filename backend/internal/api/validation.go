package api

import (
	"fmt"
	"net/http"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/labstack/echo/v4"
	echomiddleware "github.com/oapi-codegen/echo-middleware"
)

func requestValidator(spec *openapi3.T) echo.MiddlewareFunc {
	// openapi.yaml の required / minLength 等をリクエスト受理前に強制する
	// (ADR 0010: kin-openapi による validation は spec から従属的に得られる)。
	return echomiddleware.OapiRequestValidatorWithOptions(spec, &echomiddleware.Options{
		ErrorHandler: func(c echo.Context, err *echo.HTTPError) error {
			// middleware はリクエスト不正を 400 で返すが、docs/spec/api.md では
			// バリデーション失敗は 422 + 統一エラー封筒。404 / 405 等はそのまま
			// httpErrorHandler に流して封筒化する。
			if err.Code == http.StatusBadRequest {
				return c.JSON(http.StatusUnprocessableEntity, NewError("validation_failed", fmt.Sprint(err.Message)))
			}
			return err
		},
	})
}
