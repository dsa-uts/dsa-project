package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/dsa-uts/dsa-project/database"
	"github.com/dsa-uts/dsa-project/database/model"
	"github.com/dsa-uts/dsa-project/database/model/queuestatus"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

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

	ctx := context.Background()
	textHandler := slog.NewTextHandler(os.Stdout, nil)
	logger := slog.New(textHandler)

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

	for {
		// Infinite loop to keep the program running

		// Fetch Pending tasks from JobQueue
		jobs, err := jobQueueStore.FetchJobs(ctx, queuestatus.Pending, 1)

		if err != nil {
			logger.Error("Failed to fetch jobs", slog.String("error", err.Error()))
			continue
		}

		if len(jobs) == 0 {
			// logger.Info("No pending jobs found. Sleeping for a while...")
			// Sleep for a while before checking again
			time.Sleep(5 * time.Second) // Uncomment this line to add a delay
			continue
		}

		// Pick the first job
		job := jobs[0]
		logger.Info("Processing job", slog.Int64("job_id", job.ID))

		// Update the job status to "processing"
		err = jobQueueStore.UpdateJobStatus(ctx, job.ID, queuestatus.Processing)

		if err != nil {
			logger.Error("Failed to update job status to processing", slog.String("error", err.Error()))
			panic(err)
		}

		// Execute the job
		result, err := jobExecutor.ExecuteJob(ctx, &job.Detail)
		if err != nil {
			logger.Error("Failed to execute job", slog.String("error", err.Error()))
			// Update the job status to "failed"
			err = jobQueueStore.UpdateJobStatus(ctx, job.ID, queuestatus.Failed)
			if err != nil {
				logger.Error("Failed to update job status to failed", slog.String("error", err.Error()))
				panic(err)
			}
			// Skip to the next job
			continue
		}

		// Update the job status to "done" and store the result
		err = jobQueueStore.UpdateJobStatus(ctx, job.ID, queuestatus.Done)
		if err != nil {
			logger.Error("Failed to update job status to done", slog.String("error", err.Error()))
			panic(err)
		}
		if result == nil {
			logger.Error("Job execution returned nil result")
			continue
		}

		// Register the result in ResultQueue
		resultEntry := &model.ResultQueue{
			JobID:     job.ID,
			CreatedAt: time.Now(),
			ResultID:  result.ResultID,
			Log:       *result,
		}

		// Insert the result into the database
		err = jobQueueStore.InsertResult(ctx, resultEntry)
		if err != nil {
			logger.Error("Failed to insert result", slog.String("error", err.Error()))
			panic(err)
		} else {
			logger.Info("Result inserted successfully", slog.Int64("result_id", resultEntry.ID))
		}

		logger.Info("Job completed", slog.Int64("job_id", job.ID), slog.Any("result", result))
	}
}

func read_db_password() string {
	data, err := os.ReadFile("/run/secrets/db_app_password")
	if err != nil {
		log.Fatalf("failed to read db password: %v", err)
	}
	return strings.TrimSpace(string(data))
}
