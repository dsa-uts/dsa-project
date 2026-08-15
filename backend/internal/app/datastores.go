// Package app owns process-level application startup and shutdown.
package app

import (
	"context"
	"errors"
	"fmt"

	"github.com/redis/go-redis/v9"
	"github.com/uptrace/bun"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

type DatastoreConfig struct {
	DatabaseURL string
	RedisURL    string
}

type Datastores struct {
	DB    *bun.DB
	Redis *redis.Client
}

// ConnectDatastores verifies both required datastores and applies embedded
// PostgreSQL migrations before the HTTP server is allowed to start.
func ConnectDatastores(ctx context.Context, cfg DatastoreConfig) (*Datastores, error) {
	if cfg.DatabaseURL == "" {
		return nil, errors.New("PostgreSQL configuration is required (DATABASE_URL)")
	}
	if cfg.RedisURL == "" {
		return nil, errors.New("Redis configuration is required (REDIS_URL)")
	}

	redisOptions, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("parse Redis configuration: %w", err)
	}
	redisClient := redis.NewClient(redisOptions)
	if err := redisClient.Ping(ctx).Err(); err != nil {
		_ = redisClient.Close()
		return nil, fmt.Errorf("connect to Redis: %w", err)
	}

	db := store.Open(cfg.DatabaseURL)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		_ = redisClient.Close()
		return nil, fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	if err := store.Migrate(ctx, db); err != nil {
		_ = db.Close()
		_ = redisClient.Close()
		return nil, fmt.Errorf("apply PostgreSQL migrations: %w", err)
	}

	return &Datastores{DB: db, Redis: redisClient}, nil
}

func (d *Datastores) Close() error {
	return errors.Join(d.DB.Close(), d.Redis.Close())
}
