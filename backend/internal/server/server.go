// Package server assembles the HTTP handler and routes.
package server

import (
	"net/http"

	"github.com/uptrace/bun"

	"github.com/dsa-uts/dsa-project/backend/internal/api"
	"github.com/dsa-uts/dsa-project/backend/internal/resourceimport"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

// New builds the HTTP handler with all routes registered. Production startup
// only calls New after both required datastores have connected successfully.
func New(
	db *bun.DB,
	source *resourceimport.Source,
) http.Handler {
	if db == nil {
		panic("Server.New: db must not be nil")
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", Health)

	mux.Handle("/", api.NewHandler(
		store.NewAccountStore(db),
		store.NewProjectStore(db),
		store.NewRequestStore(db),
		source,
	))

	return mux
}
