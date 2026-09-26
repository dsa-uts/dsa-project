package store

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type RequestStore struct{ db *bun.DB }

func NewRequestStore(db *bun.DB) *RequestStore { return &RequestStore{db: db} }

var (
	ErrSubmissionOwner = errors.New("submission_owner_mismatch")
	ErrSubmissionScope = errors.New("submission_scope_mismatch")
)

// CreateValidation commits the Submission, files and Request together. Unique
// constraints also protect content deduplication across concurrent requests.
func (s *RequestStore) CreateValidation(ctx context.Context, actor *UserAccount, projectID uuid.UUID, submissionID *uuid.UUID, files []SubmissionFile, hash string) (*Request, error) {
	result := new(Request)
	err := s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		project := new(Project)
		query := tx.NewSelect().Model(project).Where("id = ?", projectID)
		if actor.Role == "student" {
			query = query.Where("published_at <= CURRENT_TIMESTAMP")
		}
		if err := query.Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		submission := &Submission{ProjectID: projectID, Kind: "validation", SubjectUserID: actor.ID, ContentHash: hash}
		if submissionID != nil {
			if err := tx.NewSelect().Model(submission).Where("id = ?", *submissionID).Scan(ctx); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return ErrNotFound
				}
				return err
			}
			if submission.SubjectUserID != actor.ID {
				return ErrSubmissionOwner
			}
			if submission.ProjectID != projectID || submission.Kind != "validation" {
				return ErrSubmissionScope
			}
		} else {
			inserted, err := tx.NewInsert().Model(submission).On("CONFLICT (project_id, kind, subject_user_id, content_hash) DO NOTHING").Returning("id").Exec(ctx)
			if err != nil {
				return err
			}
			count, err := inserted.RowsAffected()
			if err != nil {
				return err
			}
			if count == 0 {
				if err := tx.NewSelect().Model(submission).Where("project_id = ? AND kind = ? AND subject_user_id = ? AND content_hash = ?", projectID, "validation", actor.ID, hash).Scan(ctx); err != nil {
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
		*result = Request{ProjectID: projectID, SubmissionID: submission.ID, VersionID: project.LatestVersionID, RequestedBy: actor.ID, State: "pending"}
		if _, err := tx.NewInsert().Model(result).Exec(ctx); err != nil {
			return err
		}
		return nil
	})
	return result, err
}
