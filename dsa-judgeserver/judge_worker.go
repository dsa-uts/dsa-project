package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/dsa-uts/dsa-project/database"
	"github.com/dsa-uts/dsa-project/database/model"
	"github.com/dsa-uts/dsa-project/database/model/queuestatus"
)

type JobWorker struct {
	id       int
	jobChan  chan *model.JobQueue
	executor *JobExecutor
	jobStore *database.JobQueueStore
	logger   *slog.Logger
}

func (w *JobWorker) Start(ctx context.Context) {
	go func() {
		for {
			select {
			case job := <-w.jobChan:
				w.processJob(ctx, job)
			case <-ctx.Done():
				w.logger.Info("Worker shutting down", slog.Int("worker_id", w.id))
				return
			}
		}
	}()
}

func (w *JobWorker) processJob(ctx context.Context, job *model.JobQueue) {
	if job == nil {
		w.logger.Error("Received nil job to process", slog.Int("worker_id", w.id))
		return
	}

	logger := w.logger.With(
		slog.Int("worker_id", w.id),
		slog.Int64("job_id", job.ID),
	)

	logger.Info("Processing job")

	// Update job status to Processing
	if err := w.jobStore.UpdateJobStatus(ctx, job.ID, queuestatus.Processing); err != nil {
		logger.Error("Failed to update job status to Processing", slog.String("error", err.Error()))
		return
	}

	// Execute the job
	result, err := w.executor.ExecuteJob(ctx, &job.Detail)
	if err != nil {
		logger.Error("Failed to execute job", slog.String("error", err.Error()))
		// Update job status to Failed
		err = w.jobStore.UpdateJobStatus(ctx, job.ID, queuestatus.Failed)
		if err != nil {
			logger.Error("Failed to update job status to Failed", slog.String("error", err.Error()))
		}
		return
	}

	if result == nil {
		logger.Error("Job execution returned nil result")
		// Update job status to Failed
		err = w.jobStore.UpdateJobStatus(ctx, job.ID, queuestatus.Failed)
		if err != nil {
			logger.Error("Failed to update job status to Failed", slog.String("error", err.Error()))
		}
		return
	}

	// Update job status to Done and insert result in a transaction
	resultEntry := &model.ResultQueue{
		JobID:     job.ID,
		CreatedAt: time.Now(),
		ResultID:  result.ResultID,
		Log:       *result,
	}

	err = w.jobStore.UpdateJobStatusAndInsertResult(
		ctx, job.ID, queuestatus.Done, resultEntry)
	if err != nil {
		logger.Error("Failed to update job status to Done and insert result", slog.String("error", err.Error()))
		// Update job status to Failed
		err = w.jobStore.UpdateJobStatus(ctx, job.ID, queuestatus.Failed)
		if err != nil {
			logger.Error("Failed to update job status to Failed", slog.String("error", err.Error()))
		}
	}

	logger.Info("Job processed successfully")
}
