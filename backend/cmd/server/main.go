package main

import (
	"context"
	"log"
	"net"
	"os"

	"github.com/uptrace/bun"

	"github.com/dsa-uts/dsa-project/backend/internal/server"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// DATABASE_URL が無くても起動する: Helm chart にまだ PostgreSQL が無いため
	// (デプロイ構成の変更は scaffolding の scope 外)。DB を使うエンドポイントは
	// 500 database_unavailable を返す。
	var db *bun.DB
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		db = store.Open(dsn)
		if err := store.Migrate(context.Background(), db); err != nil {
			log.Fatalf("apply migrations: %v", err)
		}
	} else {
		log.Println("DATABASE_URL is not set; running without a database")
	}

	e := server.New(db)
	log.Fatal(e.Start(net.JoinHostPort("", port)))
}
