// Package app owns process-level application startup and shutdown.
package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/uptrace/bun"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

// ConnectDatabase verifies PostgreSQL and applies embedded migrations before
// the HTTP server is allowed to start.
func ConnectDatabase(ctx context.Context, databaseURL string, developmentSeed ...bool) (*bun.DB, error) {
	if databaseURL == "" {
		return nil, errors.New("PostgreSQL configuration is required (DATABASE_URL)")
	}

	db := store.Open(databaseURL)
	var connectErr error
	for {
		connectErr = db.PingContext(ctx)
		if connectErr == nil {
			break
		}
		select {
		case <-ctx.Done():
			_ = db.Close()
			return nil, fmt.Errorf("connect to PostgreSQL: %w", connectErr)
		case <-time.After(500 * time.Millisecond):
		}
	}
	if err := store.Migrate(ctx, db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply PostgreSQL migrations: %w", err)
	}
	if len(developmentSeed) > 0 && developmentSeed[0] {
		if err := store.SeedDevelopment(ctx, db); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("seed development data: %w", err)
		}
	}

	return db, nil
}
