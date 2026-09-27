package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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

type RequestStore struct{ db *bun.DB }

func NewRequestStore(db *bun.DB) *RequestStore { return &RequestStore{db: db} }

var (
	ErrSubmissionOwner = errors.New("submission_owner_mismatch")
	ErrSubmissionScope = errors.New("submission_scope_mismatch")
)

// CreateValidation commits the Submission, files and Request together. Unique
// constraints also protect content deduplication across concurrent requests.
func (s *RequestStore) CreateValidation(
	ctx context.Context,
	actorID uuid.UUID,
	actorRole Role,
	projectID uuid.UUID,
	submissionID *uuid.UUID,
	files []SubmissionFile,
	hash string,
) (*Request, error) {
	result := new(Request)
	err := s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		project := new(Project)
		query := tx.NewSelect().
			Model(project).
			Where("id = ?", projectID)
		if actorRole == RoleStudent {
			query = query.Where("published_at <= CURRENT_TIMESTAMP")
		}
		if err := query.Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		submission := &Submission{
			ProjectID:     projectID,
			Kind:          ValidationKind,
			SubjectUserID: actorID,
			ContentHash:   hash,
		}
		if submissionID != nil {
			if err := tx.NewSelect().Model(submission).Where("id = ?", *submissionID).Scan(ctx); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return ErrNotFound
				}
				return err
			}
			if submission.SubjectUserID != actorID {
				return ErrSubmissionOwner
			}
			if submission.ProjectID != projectID || submission.Kind != ValidationKind {
				return ErrSubmissionScope
			}
		} else {
			inserted, err := tx.NewInsert().
				Model(submission).
				On("CONFLICT (project_id, kind, subject_user_id, content_hash) DO NOTHING").
				Returning("id").
				Exec(ctx)
			if err != nil {
				return err
			}
			count, err := inserted.RowsAffected()
			if err != nil {
				return err
			}
			if count == 0 {
				if err := tx.NewSelect().
					Model(submission).
					Where("project_id = ? AND kind = ? AND subject_user_id = ? AND content_hash = ?", projectID, "validation", actorID, hash).
					Scan(ctx); err != nil {
					return err
				}
			} else {
				for i := range files {
					files[i].SubmissionID = submission.ID
				}
				if _, err := tx.NewInsert().Model(&files).Exec(ctx); err != nil {
					return err
				}
			}
		}
		*result = Request{
			ProjectID:    projectID,
			SubmissionID: submission.ID,
			VersionID:    project.LatestVersionID,
			RequestedBy:  actorID,
			State:        PendingState,
		}
		if _, err := tx.NewInsert().Model(result).Exec(ctx); err != nil {
			return err
		}
		return nil
	})
	return result, err
}
