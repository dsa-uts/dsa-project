package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/config"
	"github.com/dsa-uts/dsa-project/backend/internal/resourceimport"
	"github.com/dsa-uts/dsa-project/backend/internal/server"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	startupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cfg, err := config.LoadServer()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}
	source, err := resourceimport.NewSource(cfg.ResourceRepositoryURL, cfg.ResourceGitHubToken)
	if err != nil {
		return fmt.Errorf("configure Resource source: %w", err)
	}

	db, err := store.ConnectDatabase(startupCtx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("initialize datastores: %w", err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			log.Printf("close database: %v", err)
		}
	}()

	if err := store.MigrateSchema(startupCtx, db); err != nil {
		return fmt.Errorf("migrate database: %w", err)
	}

	if cfg.DevelopmentSeed {
		if err := store.SeedDevelopment(startupCtx, db); err != nil {
			return fmt.Errorf("seed development: %w", err)
		}
	}

	e := server.New(db, source)
	return e.Start(net.JoinHostPort("", cfg.Port))
}
