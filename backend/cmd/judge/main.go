package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/config"
	"github.com/dsa-uts/dsa-project/backend/internal/judge"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/google/uuid"
)

func main() {
	if err := run(); err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("judge: %v", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	cfg, err := config.Get()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}

	startupCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	db, err := store.ConnectDatabase(startupCtx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer db.Close()

	cancel()

	// 起動ごとに生成し、このプロセスが担当するRequestのlease_ownerに使う
	ownerID := uuid.New()
	log.Printf("judge started: owner=%s", ownerID)

	return judge.Run(ctx, db, ownerID)
}
