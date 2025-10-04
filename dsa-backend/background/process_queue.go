package background

import (
	"context"
	"time"

	"github.com/dsa-uts/dsa-project/database"
	"github.com/dsa-uts/dsa-project/database/model/queuestatus"
	"github.com/dsa-uts/dsa-project/database/model/queuetype"
	"github.com/dsa-uts/dsa-project/database/model/requeststatus"
	"github.com/labstack/echo/v4"
	"github.com/uptrace/bun"
)

func ProcessJobQueue(ctx context.Context, db *bun.DB, logger *echo.Logger) {
	jobQueueStore := database.NewJobQueueStore(db)
	requestStore := database.NewRequestStore(db)

	for {
		triggered := false
		// -------------------------------------------------------------------------
		// Fetch "processing" jobs from the job queue
		// and then update the corresponding request status to "judging"
		// -------------------------------------------------------------------------
		processingJobs, err := jobQueueStore.FetchJobs(ctx, queuestatus.Processing, 100)
		if err != nil {
			(*logger).Fatalf("Failed to fetch processing jobs: %v", err)
			continue
		}

		if len(processingJobs) > 0 {
			triggered = true
		}

		for _, job := range processingJobs {
			switch job.RequestType {
			case queuetype.Validation:
				err = requestStore.UpdateValidationRequestStatus(ctx, job.RequestID, requeststatus.Judging)
			case queuetype.Grading:
				err = requestStore.UpdateGradingRequestStatus(ctx, job.RequestID, requeststatus.Judging)
			default:
				(*logger).Errorf("Unknown request type: %s", job.RequestType)
				continue
			}
			if err != nil {
				(*logger).Errorf("Failed to update request status for job ID %d: %v", job.ID, err)
				continue
			}
		}

		// -------------------------------------------------------------------------
		// Fetch "failed" jobs from the job queue
		// and then update the result of corresponding request to "IE"
		// -------------------------------------------------------------------------
		failedJobs, err := jobQueueStore.FetchJobs(ctx, queuestatus.Failed, 100)
		if err != nil {
			(*logger).Fatalf("Failed to fetch failed jobs: %v", err)
			continue
		}

		if len(failedJobs) > 0 {
			triggered = true
		}

		for _, job := range failedJobs {
			switch job.RequestType {
			case queuetype.Validation:
				err = requestStore.UpdateValidationRequestStatus(ctx, job.RequestID, requeststatus.IE)
			case queuetype.Grading:
				err = requestStore.UpdateGradingRequestStatus(ctx, job.RequestID, requeststatus.IE)
			default:
				(*logger).Errorf("Unknown request type: %s", job.RequestType)
				continue
			}

			if err != nil {
				(*logger).Errorf("Failed to update request status for job ID %d: %v", job.ID, err)
				continue
			}

			// Delete the failed job from the job queue
			err = jobQueueStore.DeleteJobEntry(ctx, job.ID)
			if err != nil {
				(*logger).Errorf("Failed to delete failed job ID %d: %v", job.ID, err)
				continue
			}
		}

		// -------------------------------------------------------------------------
		// Fetch results from result queue
		// -------------------------------------------------------------------------
		results, err := jobQueueStore.FetchResults(ctx, 100)
		if err != nil {
			(*logger).Errorf("Failed to fetch results: %v", err)
			continue
		}

		if len(results) > 0 {
			triggered = true
		}

		for _, result := range results {
			job := result.Job
			if job == nil {
				(*logger).Errorf("Job relation is nil for result ID %d", result.ID)
				continue
			}

			// Update the corresponding request with the result
			var err error
			switch job.RequestType {
			case queuetype.Validation:
				err = requestStore.UpdateResultOfValidationRequest(ctx, job.RequestID, result.ResultID, result.Log)
			case queuetype.Grading:
				err = requestStore.UpdateResultOfGradingRequest(ctx, job.RequestID, result.ResultID, result.Log)
			default:
				(*logger).Errorf("Unknown request type: %s", job.RequestType)
				continue
			}
			if err != nil {
				(*logger).Errorf("Failed to update request result for request ID %d: %v", job.RequestID, err)
				continue
			}

			// Delete the processed result entry from job queue and result queue
			err = jobQueueStore.DeleteResultEntry(ctx, result.ID)
			if err != nil {
				(*logger).Errorf("Failed to delete result ID %d: %v", result.ID, err)
				continue
			}

			err = jobQueueStore.DeleteJobEntry(ctx, job.ID)
			if err != nil {
				(*logger).Errorf("Failed to delete job ID %d: %v", job.ID, err)
				continue
			}
		}

		if !triggered {
			// Sleep for a while if no jobs were processed
			time.Sleep(2 * time.Second)
		} else {
			time.Sleep(100 * time.Millisecond)
		}

		select {
		case <-ctx.Done():
			(*logger).Info("Job queue processor shutting down...")
			return
		default:
			// continue processing
		}
	}
}
