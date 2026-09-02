// Package server assembles the Echo instance: routes, spec-driven request
// validation, and the unified error envelope.
package server

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	echo "github.com/labstack/echo/v4"
	echomiddleware "github.com/oapi-codegen/echo-middleware"
	"github.com/uptrace/bun"

	"github.com/dsa-uts/dsa-project/backend/internal/api"
	"github.com/dsa-uts/dsa-project/backend/internal/handler"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

// New builds the Echo instance with all routes registered. Production startup
// only calls New after both required datastores have connected successfully.
func New(db *bun.DB) *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.HTTPErrorHandler = httpErrorHandler

	e.GET("/health", handler.Health)

	spec, err := api.GetSpec()
	if err != nil {
		// 生成コードに埋め込まれた spec なので、失敗はビルド成果物の破損のみ
		panic(fmt.Sprintf("load embedded openapi spec: %v", err))
	}
	// servers はデプロイ形態の情報で、リクエストの host 検証には使わない
	spec.Servers = nil

	// openapi.yaml の required / minLength 等をリクエスト受理前に強制する
	// (ADR 0010: kin-openapi による validation は spec から従属的に得られる)。
	validator := echomiddleware.OapiRequestValidatorWithOptions(spec, &echomiddleware.Options{
		ErrorHandler: func(c echo.Context, err *echo.HTTPError) error {
			// middleware はリクエスト不正を 400 で返すが、docs/spec/api.md では
			// バリデーション失敗は 422 + 統一エラー封筒。404 / 405 等はそのまま
			// httpErrorHandler に流して封筒化する。
			if err.Code == http.StatusBadRequest {
				return c.JSON(http.StatusUnprocessableEntity, api.NewError("validation_failed", fmt.Sprint(err.Message)))
			}
			return err
		},
	})

	var authStore *store.AuthStore
	if db != nil {
		authStore = store.NewAuthStore(db)
	}
	h := api.NewHandler(authStore)

	// validator は spec 由来のルートにだけ掛ける (group 経由で登録)。
	// no-store は validator の外側に置き、validation error にも適用する。
	noStore := func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Response().Header().Set("Cache-Control", "no-store")
			return next(c)
		}
	}
	g := e.Group("", noStore, validator)
	api.RegisterHandlers(g, api.NewStrictHandler(h, nil))

	return e
}

// httpErrorHandler renders every unhandled error as the api.md envelope.
func httpErrorHandler(err error, c echo.Context) {
	if c.Response().Committed {
		return
	}
	status := http.StatusInternalServerError
	message := "Internal server error."
	if he, ok := errors.AsType[*echo.HTTPError](err); ok {
		status = he.Code
		message = fmt.Sprint(he.Message)
	}
	// 404 → not_found のように status text から機械可読 code を導出する
	code := strings.ReplaceAll(strings.ToLower(http.StatusText(status)), " ", "_")
	if code == "" {
		code = "error"
	}
	if err := c.JSON(status, api.NewError(code, message)); err != nil {
		c.Logger().Error(err)
	}
}
