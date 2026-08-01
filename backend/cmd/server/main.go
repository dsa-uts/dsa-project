package main

import (
	"context"
	"log"
	"net"
	"os"

	"github.com/redis/go-redis/v9"
	"github.com/uptrace/bun"

	"github.com/dsa-uts/dsa-project/backend/internal/server"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// DATABASE_URL / REDIS_URL が無くても起動する: Helm chart にまだ datastores が
	// 無いため (デプロイ構成の変更は scope 外)。該当エンドポイントは
	// 500 store_unavailable を返す。
	var db *bun.DB
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		db = store.Open(dsn)
		if err := store.Migrate(context.Background(), db); err != nil {
			log.Fatalf("apply migrations: %v", err)
		}
	} else {
		log.Println("DATABASE_URL is not set; running without a database")
	}

	var rdb *redis.Client
	if url := os.Getenv("REDIS_URL"); url != "" {
		opts, err := redis.ParseURL(url)
		if err != nil {
			log.Fatalf("parse REDIS_URL: %v", err)
		}
		rdb = redis.NewClient(opts)
	} else {
		log.Println("REDIS_URL is not set; running without sessions")
	}

	e := server.New(db, rdb)
	log.Fatal(e.Start(net.JoinHostPort("", port)))
}
