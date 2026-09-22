// Package server assembles the Echo instance, health route, and unified error envelope.
package server

import (
	"cmp"
	"errors"
	"fmt"
	"net/http"
	"strings"

	echo "github.com/labstack/echo/v4"
	"github.com/uptrace/bun"

	"github.com/dsa-uts/dsa-project/backend/internal/api"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpresponse"
	"github.com/dsa-uts/dsa-project/backend/internal/handler"
	"github.com/dsa-uts/dsa-project/backend/internal/resourceimport"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

// New builds the Echo instance with all routes registered. Production startup
// only calls New after both required datastores have connected successfully.
func New(db *bun.DB, source *resourceimport.Source) *echo.Echo {
	if db == nil {
		panic("Server.New: db must not be nil")
	}

	e := echo.New()
	e.HideBanner = true
	e.HTTPErrorHandler = httpErrorHandler

	e.GET("/health", handler.Health)

	api.Register(e, store.NewAuthStore(db), store.NewProjectStore(db), source)

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
	if err := c.JSON(status, httpresponse.NewError(cmp.Or(code, "error"), message)); err != nil {
		c.Logger().Error(err)
	}
}
