// Package store owns database access: the Bun connection, migrations, and
// concrete store types. ADR 0011: store は具象型のままとし、
// repository interface 層は意図的に作らない。
package store

import (
	"context"
	"database/sql"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
	"github.com/uptrace/bun/migrate"

	"github.com/dsa-uts/dsa-project/backend/internal/store/migrations"
)

// Open connects to PostgreSQL. DSN 例: postgres://user:pass@host:5432/db?sslmode=disable
func Open(dsn string) *bun.DB {
	sqldb := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	return bun.NewDB(sqldb, pgdialect.New())
}

// Migrate applies the embedded SQL migrations (schema の source of truth は
// migrations/ の SQL ファイル)。適用済み migration はスキップされる。
func Migrate(ctx context.Context, db *bun.DB) error {
	migrator := migrate.NewMigrator(db, migrations.Migrations)
	if err := migrator.Init(ctx); err != nil {
		return err
	}
	if _, err := migrator.Migrate(ctx); err != nil {
		return err
	}
	return nil
}
