// Package app owns process-level application startup and shutdown.
package app

import (
	"context"
	"errors"
	"fmt"

	"github.com/uptrace/bun"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

// ConnectDatabase verifies PostgreSQL and applies embedded migrations before
// the HTTP server is allowed to start.
func ConnectDatabase(ctx context.Context, databaseURL string) (*bun.DB, error) {
	if databaseURL == "" {
		return nil, errors.New("PostgreSQL configuration is required (DATABASE_URL)")
	}

	db := store.Open(databaseURL)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	if err := store.Migrate(ctx, db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply PostgreSQL migrations: %w", err)
	}

	return db, nil
}
