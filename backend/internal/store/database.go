package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/store/migrations"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
	"github.com/uptrace/bun/migrate"
)

// ConnectDatabase verifies PostgreSQL and applies embedded migrations before
// the HTTP server is allowed to start.
func ConnectDatabase(ctx context.Context, databaseURL string, developmentSeed bool) (*bun.DB, error) {
	if databaseURL == "" {
		return nil, errors.New("PostgreSQL configuration is required (DATABASE_URL)")
	}

	db := openDB(databaseURL)
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
	if err := migrateSchema(ctx, db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply PostgreSQL migrations: %w", err)
	}
	if developmentSeed {
		if err := SeedDevelopment(ctx, db); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("seed development data: %w", err)
		}
	}

	return db, nil
}

// open creates a PostgreSQL handle. Callers must Ping before serving requests.
func openDB(dsn string) *bun.DB {
	// A missing Kubernetes Service endpoint can drop connection attempts instead
	// of rejecting them. Bound dialing so API failures return promptly.
	sqldb := sql.OpenDB(pgdriver.NewConnector(
		pgdriver.WithDSN(dsn),
		pgdriver.WithDialTimeout(2*time.Second),
	))
	return bun.NewDB(sqldb, pgdialect.New())
}

// Migrate applies the embedded SQL migrations (schema の source of truth は
// migrations/ の SQL ファイル)。適用済み migration はスキップされる。
func migrateSchema(ctx context.Context, db *bun.DB) error {
	migrator := migrate.NewMigrator(db, migrations.Migrations)
	if err := migrator.Init(ctx); err != nil {
		return err
	}
	if _, err := migrator.Migrate(ctx); err != nil {
		return err
	}
	return nil
}
