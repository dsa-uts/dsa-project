package main

import (
	"context"
	"log"
	"net"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/app"
	"github.com/dsa-uts/dsa-project/backend/internal/config"
	"github.com/dsa-uts/dsa-project/backend/internal/resourceimport"
	"github.com/dsa-uts/dsa-project/backend/internal/server"
)

func main() {
	startupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cfg, err := config.Get()
	if err != nil {
		log.Fatalf("load configuration: %v", err)
	}
	source, err := resourceimport.NewSource(cfg.ResourceRepositoryURL, cfg.ResourceGitHubToken)
	if err != nil {
		log.Fatalf("configure Resource source: %v", err)
	}

	db, err := app.ConnectDatabase(startupCtx, cfg.DatabaseURL, cfg.DevelopmentSeed)
	if err != nil {
		log.Fatalf("initialize datastores: %v", err)
	}
	defer db.Close()

	e := server.New(db, source)
	log.Fatal(e.Start(net.JoinHostPort("", cfg.Port)))
}
