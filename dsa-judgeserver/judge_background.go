package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/dsa-uts/dsa-project/database"
	"github.com/dsa-uts/dsa-project/database/model/queuestatus"
)

// Resets stale jobs in the job queue.
func ResetStaleJobs(ctx context.Context, jobQueueStore *database.JobQueueStore, logger *slog.Logger) error {
	const staleTimeout = 10 * time.Minute

	jobs, err := jobQueueStore.ResetStaleJobs(ctx, queuestatus.Processing, queuestatus.Pending, staleTimeout)
	if err != nil {
		return fmt.Errorf("failed to reset stale jobs: %w", err)
	}

	if len(jobs) > 0 {
		logger.Warn("Reset stale jobs:", slog.Int("count", len(jobs)), "data", jobs)
	}

	jobs, err = jobQueueStore.ResetStaleJobs(ctx, queuestatus.Fetched, queuestatus.Pending, staleTimeout)
	if err != nil {
		return fmt.Errorf("failed to reset stale fetched jobs: %w", err)
	}

	if len(jobs) > 0 {
		logger.Warn("Reset stale fetched jobs:", slog.Int("count", len(jobs)), "data", jobs)
	}

	return nil
}
