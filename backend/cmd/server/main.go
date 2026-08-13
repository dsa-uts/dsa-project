package main

import (
	"context"
	"log"
	"net"
	"os"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/app"
	"github.com/dsa-uts/dsa-project/backend/internal/server"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	startupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	datastores, err := app.ConnectDatastores(startupCtx, app.DatastoreConfig{
		DatabaseURL: os.Getenv("DATABASE_URL"),
		RedisURL:    os.Getenv("REDIS_URL"),
	})
	if err != nil {
		log.Fatalf("initialize datastores: %v", err)
	}
	defer datastores.Close()

	e := server.New(datastores.DB)
	log.Fatal(e.Start(net.JoinHostPort("", port)))
}
