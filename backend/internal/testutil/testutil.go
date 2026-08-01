// Package testutil provides the HTTP-seam test harness (ADR 0011):
// a disposable real PostgreSQL via testcontainers with migrations applied.
// Docker が無い環境 (nix sandbox 等) では `go test -short` で DB テストをスキップする。
package testutil

import (
	"context"
	"testing"

	goredis "github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
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

// StartRedis starts a Redis container and returns a connected client
// (セッションストア用。ADR 0011: datastore は fake しない)。
func StartRedis(t *testing.T) *goredis.Client {
	t.Helper()
	if testing.Short() {
		t.Skip("-short: skipping test that requires Docker (testcontainers)")
	}

	ctx := context.Background()
	rc, err := tcredis.Run(ctx, "redis:8-alpine")
	testcontainers.CleanupContainer(t, rc)
	if err != nil {
		t.Fatalf("start redis container: %v", err)
	}

	uri, err := rc.ConnectionString(ctx)
	if err != nil {
		t.Fatalf("redis connection string: %v", err)
	}
	opts, err := goredis.ParseURL(uri)
	if err != nil {
		t.Fatalf("parse redis url: %v", err)
	}
	client := goredis.NewClient(opts)
	t.Cleanup(func() { _ = client.Close() })
	return client
}
