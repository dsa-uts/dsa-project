package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/dsa-uts/dsa-project/database"
	"github.com/dsa-uts/dsa-project/database/model"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

const NUM_WORKERS = 3

func main() {
	db_user := "dsa_app"
	db_password := read_db_password()
	// TODO: modify this for production
	db_host := "db:5432"
	dsn := fmt.Sprintf("postgres://%s:%s@%s/dsa_db?sslmode=disable", db_user, db_password, db_host)

	// initialize connection
	sqldb := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))

	// create db instance
	db := bun.NewDB(sqldb, pgdialect.New())
	// For debugging purpose, print all queries to stdout.
	// db.AddQueryHook(bundebug.NewQueryHook(bundebug.WithVerbose(true)))

	jobQueueStore := database.NewJobQueueStore(db)

	// context with graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Initialize logger
	textHandler := slog.NewTextHandler(os.Stdout, nil)
	logger := slog.New(textHandler)

	// Start background worker to reset stale jobs
	go func() {
		if err := ResetStaleJobs(ctx, jobQueueStore, logger); err != nil {
			logger.Error("Error resetting stale jobs on startup", slog.String("error", err.Error()))
		}

		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			if err := ResetStaleJobs(ctx, jobQueueStore, logger); err != nil {
				logger.Error("Error resetting stale jobs", slog.String("error", err.Error()))
			}
		}
	}()

	// Create Docker Client
	jobExecutor, err := NewJobExecutor()
	if err != nil {
		logger.Error("Failed to create job executor", slog.String("error", err.Error()))
		return
	}
	defer jobExecutor.Close()

	// Check the existence of "checker-lang-gcc" and "binary-runners" docker image
	imageExists, err := jobExecutor.CheckImageExists(ctx, "checker-lang-gcc")
	if err != nil {
		logger.Error("Failed to check image existence", slog.String("error", err.Error()))
		return
	}
	if !imageExists {
		logger.Error("Docker image 'checker-lang-gcc' does not exist. Please pull the image before running the server.")
		return
	}
	logger.Info("Docker image 'checker-lang-gcc' exists.")
	imageExists, err = jobExecutor.CheckImageExists(ctx, "binary-runner")
	if err != nil {
		logger.Error("Failed to check image existence", slog.String("error", err.Error()))
		return
	}
	if !imageExists {
		logger.Error("Docker image 'binary-runners' does not exist. Please pull the image before running the server.")
		return
	}
	logger.Info("Docker image 'binary-runners' exists.")

	jobChan := make(chan *model.JobQueue, NUM_WORKERS*4)

	// Start Job Workers
	for i := range NUM_WORKERS {
		worker := &JobWorker{
			id:       i,
			jobChan:  jobChan,
			executor: jobExecutor,
			jobStore: jobQueueStore,
			logger:   logger,
		}
		worker.Start(ctx)
	}

	// Main loop to fetch and assign jobs
	go func() {
		for {
			select {
			case <-ctx.Done():
				close(jobChan)
				return
			default:
				// Fetch Pending tasks from JobQueue
				jobs, err := jobQueueStore.FetchPendingJobsAndMarkFetched(ctx, NUM_WORKERS)
				if err != nil {
					logger.Error("Failed to fetch jobs", slog.String("error", err.Error()))
					time.Sleep(3 * time.Second)
					continue
				}

				if len(jobs) == 0 {
					// No pending jobs found. Sleep for a while.
					time.Sleep(3 * time.Second)
					continue
				}

				// Assign jobs to workers
				for _, job := range jobs {
					select {
					case jobChan <- &job:
					case <-ctx.Done():
						return
					}
				}
			}
		}
	}()

	// Wait for termination signal
	sig := <-sigChan
	logger.Info("Received signal, shutting down...", slog.String("signal", sig.String()))
	cancel()

	// Give some time for cleanup
	time.Sleep(5 * time.Second)
	logger.Info("Shutdown complete")
}

func read_db_password() string {
	data, err := os.ReadFile("/run/secrets/db_app_password")
	if err != nil {
		log.Fatalf("failed to read db password: %v", err)
	}
	return strings.TrimSpace(string(data))
}
