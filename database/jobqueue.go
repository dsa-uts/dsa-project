package database

import (
	"context"

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
