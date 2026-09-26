// Package server assembles the Echo instance and routes.
package server

import (
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
	e.HTTPErrorHandler = httpresponse.ErrorHandler

	e.GET("/health", handler.Health)

	api.Register(e, store.NewAuthStore(db), store.NewProjectStore(db), store.NewRequestStore(db), source)

	return e
}
