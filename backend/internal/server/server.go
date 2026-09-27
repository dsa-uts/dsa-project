// Package server assembles the Echo instance and routes.
package server

import (
	"github.com/aws/aws-sdk-go-v2/service/s3"
	echo "github.com/labstack/echo/v4"
	"github.com/uptrace/bun"

	"github.com/dsa-uts/dsa-project/backend/internal/api"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpresponse"
	"github.com/dsa-uts/dsa-project/backend/internal/resourceimport"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

// New builds the Echo instance with all routes registered. Production startup
// only calls New after both required datastores have connected successfully.
func New(
	db *bun.DB,
	source *resourceimport.Source,
	objects *s3.Client,
	bucket string,
) *echo.Echo {
	if db == nil {
		panic("Server.New: db must not be nil")
	}

	e := echo.New()
	e.HideBanner = true
	e.HTTPErrorHandler = httpresponse.ErrorHandler

	e.GET("/health", Health)

	api.Register(e, store.NewAccountStore(db), store.NewProjectStore(db), store.NewRequestStore(db, objects, bucket), source)

	return e
}
