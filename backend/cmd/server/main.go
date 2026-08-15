package main

import (
	"context"
	"log"
	"net"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/app"
	"github.com/dsa-uts/dsa-project/backend/internal/config"
	"github.com/dsa-uts/dsa-project/backend/internal/server"
)

func main() {
	startupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cfg, err := config.Get()
	if err != nil {
		log.Fatalf("load configuration: %v", err)
	}
	datastores, err := app.ConnectDatastores(startupCtx, app.DatastoreConfig{
		DatabaseURL: cfg.DatabaseURL,
		RedisURL:    cfg.RedisURL,
	})
	if err != nil {
		log.Fatalf("initialize datastores: %v", err)
	}
	defer datastores.Close()

	e := server.New(datastores.DB)
	log.Fatal(e.Start(net.JoinHostPort("", cfg.Port)))
}
