package store

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type SubmissionKind string

const (
	ValidationKind SubmissionKind = "validation"
	EvaluationKind SubmissionKind = "evaluation"
)

type Submission struct {
	bun.BaseModel `bun:"table:submissions"`

	ID                  uuid.UUID      `bun:"id,pk,default:uuidv7()"`
	ProjectID           uuid.UUID      `bun:"project_id,notnull"`
	Kind                SubmissionKind `bun:"kind,notnull"`
	SubjectUserID       uuid.UUID      `bun:"subject_user_id,notnull"`
	ContentHash         string         `bun:"content_hash,notnull"`
	OriginalSubmittedAt *time.Time     `bun:"original_submitted_at"`
	CreatedAt           time.Time      `bun:"created_at,notnull,default:now()"`
}

type SubmissionFile struct {
	bun.BaseModel `bun:"table:submission_files"`

	SubmissionID uuid.UUID `bun:"submission_id,pk"`
	Path         string    `bun:"path,pk"`
	ObjectKey    string    `bun:"object_key,notnull"`
	Content      []byte    `bun:"-"`
}
