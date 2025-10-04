package model

import (
	"context"
	"time"

	"github.com/dsa-uts/dsa-project/database/model/queuestatus"
	"github.com/dsa-uts/dsa-project/database/model/queuetype"
	"github.com/dsa-uts/dsa-project/database/model/requeststatus"
	"github.com/uptrace/bun"
)

type JobQueue struct {
	bun.BaseModel `bun:"table:jobqueue"`

	ID          int64              `bun:"id,pk,autoincrement" json:"id"`
	RequestType queuetype.Type     `bun:"request_type,notnull" json:"request_type"` // "validation" or "grading"
	RequestID   int64              `bun:"request_id,notnull" json:"request_id"`
	Status      queuestatus.Status `bun:"status,notnull" json:"status"` // "pending", "processing", "done"
	CreatedAt   time.Time          `bun:"created_at,notnull" json:"created_at"`
	Detail      JobDetail          `bun:"detail,notnull,type:jsonb" json:"detail"`
}

type JobDetail struct {
	TimeMS      int64      `json:"time_ms"`
	MemoryMB    int64      `json:"memory_mb"`
	TestFiles   []string   `json:"test_files"`
	ResourceDir string     `json:"resource_dir"` // directory that contains resource files (e.g., stdin input for judge tasks)
	FileDir     string     `json:"file_dir"`     // directory that contain submitted codes
	ResultDir   string     `json:"result_dir"`   // directory that outputs will be stored
	BuildTasks  []TestCase `json:"build"`
	JudgeTasks  []TestCase `json:"judge"`
}

type ResultQueue struct {
	bun.BaseModel `bun:"table:resultqueue"`

	ID        int64               `bun:"id,pk,autoincrement" json:"id"`
	JobID     int64               `bun:"job_id,notnull" json:"job_id"`
	CreatedAt time.Time           `bun:"created_at,notnull" json:"created_at"`
	ResultID  requeststatus.State `bun:"result,notnull" json:"result_id"`
	Log       RequestLog          `bun:"log,notnull,type:jsonb" json:"log"`

	Result *ResultValues `bun:"rel:has-one,join:result=value"`
	Job    *JobQueue     `bun:"rel:belongs-to,join:job_id=id"`
}

var _ bun.BeforeAppendModelHook = (*JobQueue)(nil)

func (jq *JobQueue) BeforeAppendModel(ctx context.Context, query bun.Query) error {
	switch query.(type) {
	case *bun.InsertQuery, *bun.UpdateQuery:
		// remove fraction less than seconds (milliseconds, microseconds, ...)
		jq.CreatedAt = jq.CreatedAt.Truncate(time.Second)
	}
	return nil
}

var _ bun.BeforeAppendModelHook = (*ResultQueue)(nil)

func (rq *ResultQueue) BeforeAppendModel(ctx context.Context, query bun.Query) error {
	switch query.(type) {
	case *bun.InsertQuery, *bun.UpdateQuery:
		// remove fraction less than seconds (milliseconds, microseconds, ...)
		rq.CreatedAt = rq.CreatedAt.Truncate(time.Second)
	}
	return nil
}
