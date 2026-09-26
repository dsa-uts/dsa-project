package store

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type RequestState string

const (
	PendingState   RequestState = "pending"
	RunningState   RequestState = "running"
	RetryingState  RequestState = "retrying"
	CompletedState RequestState = "completed"
)

type Request struct {
	bun.BaseModel `bun:"table:requests"`

	ID             uuid.UUID       `bun:"id,pk,default:uuidv7()"`
	ProjectID      uuid.UUID       `bun:"project_id,notnull"`
	SubmissionID   uuid.UUID       `bun:"submission_id,notnull"`
	VersionID      uuid.UUID       `bun:"version_id,notnull"`
	RequestedBy    uuid.UUID       `bun:"requested_by,notnull"`
	RequestedAt    time.Time       `bun:"requested_at,notnull,default:now()"`
	State          RequestState    `bun:"state,notnull,default:'pending'"`
	Status         *string         `bun:"status"`
	Result         json.RawMessage `bun:"result,type:jsonb"`
	LeaseOwner     *uuid.UUID      `bun:"lease_owner"`
	LeaseExpiresAt *time.Time      `bun:"lease_expires_at"`
	AttemptCount   int32           `bun:"attempt_count,notnull,default:0"`
}
