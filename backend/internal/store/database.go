package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/store/migrations"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/jackc/pgx/v5"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/migrate"
)

// ConnectDatabase verifies PostgreSQL and applies embedded migrations before
// the HTTP server is allowed to start.
func ConnectDatabase(ctx context.Context, databaseURL string) (*bun.DB, error) {
	if databaseURL == "" {
		return nil, errors.New("PostgreSQL configuration is required (DATABASE_URL)")
	}

	db, err := openDB(databaseURL)
	if err != nil {
		return nil, err
	}
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

	return db, nil
}

// open creates a PostgreSQL handle. Callers must Ping before serving requests.
func openDB(dsn string) (*bun.DB, error) {
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse PostgreSQL config: %w", err)
	}

	config.ConnectTimeout = 2 * time.Second
	config.DefaultQueryExecMode = pgx.QueryExecModeCacheStatement

	sqldb := stdlib.OpenDB(*config)
	return bun.NewDB(sqldb, pgdialect.New()), nil
}

// Migrate applies the embedded SQL migrations (schema の source of truth は
// migrations/ の SQL ファイル)。適用済み migration はスキップされる。
func MigrateSchema(ctx context.Context, db *bun.DB) error {
	migrator := migrate.NewMigrator(db, migrations.Migrations)
	if err := migrator.Init(ctx); err != nil {
		return err
	}
	if _, err := migrator.Migrate(ctx); err != nil {
		return err
	}
	return nil
}
