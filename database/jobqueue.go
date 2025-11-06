package database

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/dsa-uts/dsa-project/database/model"
	"github.com/dsa-uts/dsa-project/database/model/queuestatus"
	"github.com/uptrace/bun"
)

type JobQueueStore struct {
	db *bun.DB
}

func (j *JobQueueStore) InsertResult(context context.Context, resultEntry *model.ResultQueue) error {
	_, err := j.db.NewInsert().Model(resultEntry).Exec(context)
	return err
}

func (j *JobQueueStore) UpdateJobStatus(context context.Context, id int64, processing queuestatus.Status) error {
	_, err := j.db.NewUpdate().Model(&model.JobQueue{}).Set("status = ?", processing).Where("id = ?", id).Exec(context)
	return err
}

func (j *JobQueueStore) InsertJob(context context.Context, job *model.JobQueue) error {
	_, err := j.db.NewInsert().Model(job).Exec(context)
	return err
}

func NewJobQueueStore(db *bun.DB) *JobQueueStore {
	return &JobQueueStore{
		db: db,
	}
}

func (j *JobQueueStore) FetchJobs(ctx context.Context, status queuestatus.Status, limit int32) ([]model.JobQueue, error) {
	var jobs []model.JobQueue
	err := j.db.NewSelect().Model(&jobs).Where("status = ?", status).Limit(int(limit)).Scan(ctx)
	return jobs, err
}

func (j *JobQueueStore) FetchPendingJobsAndMarkFetched(ctx context.Context, limit int32) ([]model.JobQueue, error) {
	var jobs []model.JobQueue
	err := j.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		// Fetch pending jobs
		err := tx.NewSelect().Model(&jobs).Where("status = ?", queuestatus.Pending).Limit(int(limit)).Scan(ctx)
		if err != nil {
			return fmt.Errorf("failed to fetch pending jobs: %w", err)
		}

		// Mark fetched jobs as Fetched
		var jobIDs []int64
		for _, job := range jobs {
			jobIDs = append(jobIDs, job.ID)
		}
		if len(jobIDs) > 0 {
			_, err = tx.NewUpdate().Model(&model.JobQueue{}).
				Set("status = ?", queuestatus.Fetched).
				Where("id IN (?)", bun.In(jobIDs)).
				Exec(ctx)
			if err != nil {
				return fmt.Errorf("failed to update job status to Fetched: %w", err)
			}
		}

		return nil
	})
	return jobs, err
}

func (j *JobQueueStore) FetchResults(ctx context.Context, limit int32) ([]model.ResultQueue, error) {
	var results []model.ResultQueue
	err := j.db.NewSelect().Model(&results).Relation("Job").Limit(int(limit)).Scan(ctx)
	return results, err
}

func (j *JobQueueStore) DeleteResultEntry(ctx context.Context, id int64) error {
	_, err := j.db.NewDelete().Model(&model.ResultQueue{}).Where("id = ?", id).Exec(ctx)
	return err
}

func (j *JobQueueStore) DeleteJobEntry(ctx context.Context, id int64) error {
	_, err := j.db.NewDelete().Model(&model.JobQueue{}).Where("id = ?", id).Exec(ctx)
	return err
}

func (j *JobQueueStore) ResetStaleJobs(ctx context.Context, from, to queuestatus.Status, timeout time.Duration) ([]int64, error) {
	var jobs []int64
	err := j.db.NewUpdate().
		Model(&model.JobQueue{}).
		Set("status = ?", to).
		Where("status = ? AND created_at < ?", from, time.Now().Add(-timeout)).
		Returning("request_id").
		Scan(ctx, &jobs)
	return jobs, err
}

func (j *JobQueueStore) UpdateJobStatusAndInsertResult(
	ctx context.Context,
	jobID int64,
	status queuestatus.Status,
	result *model.ResultQueue) error {
	return j.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		// Insert result into ResultQueue
		_, err := tx.NewInsert().Model(result).Exec(ctx)
		if err != nil {
			return fmt.Errorf("failed to insert result: %w", err)
		}

		// Update job status in JobQueue
		_, err = tx.NewUpdate().Model(&model.JobQueue{}).
			Set("status = ?", status).
			Where("id = ?", jobID).
			Exec(ctx)
		if err != nil {
			return fmt.Errorf("failed to update job status: %w", err)
		}

		return nil
	})
}
