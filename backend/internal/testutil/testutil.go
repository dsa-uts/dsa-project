// Package testutil provides the legacy in-process HTTP-seam test harness.
// ADR 0012 supersedes this testcontainers path with tests against an isolated,
// deployed Helm release; this package remains only until that migration lands.
// Docker が無い環境 (nix sandbox 等) では `go test -short` で DB テストをスキップする。
package testutil

import (
	"context"
	"testing"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/uptrace/bun"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

// StartPostgres starts a PostgreSQL container, applies all migrations, and
// returns a connected *bun.DB. The container and connection are cleaned up
// with the test.
func StartPostgres(t *testing.T) *bun.DB {
	t.Helper()
	if testing.Short() {
		t.Skip("-short: skipping test that requires Docker (testcontainers)")
	}

	ctx := context.Background()
	pgc, err := postgres.Run(ctx, "postgres:17-alpine",
		postgres.WithDatabase("dsa_test"),
		postgres.WithUsername("dsa"),
		postgres.WithPassword("dsa"),
		postgres.BasicWaitStrategies(),
	)
	testcontainers.CleanupContainer(t, pgc)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}

	dsn, err := pgc.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("postgres connection string: %v", err)
	}

	db := store.Open(dsn)
	t.Cleanup(func() { _ = db.Close() })
	if err := store.Migrate(ctx, db); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	return db
}
