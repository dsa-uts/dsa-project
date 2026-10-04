package store

import (
	"context"
	"database/sql"
	"errors"

	resource "github.com/dsa-uts/dsa-resource-spec"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type ValidationRecord struct {
	ValidationSummary
	SubmissionID uuid.UUID
	VersionID    uuid.UUID
	AttemptCount int32
}

type ValidationDetail struct {
	ValidationRecord
	Resource  resource.Resource
	Results   []WorkflowResult
	Artifacts []ArtifactMetadata
}

// ArtifactMetadata deliberately excludes content from polling responses.
type ArtifactMetadata struct {
	WorkflowID string
	JobID      string
	Name       string
	SizeBytes  *int64
	Error      *string
}

type ValidationFiles struct {
	Submission []SubmissionFile
	Resource   resource.Resource
}

type ValidationArtifacts struct {
	Resource resource.Resource
	Files    []Artifact
}

var ErrRequestNotCompleted = errors.New("request has not completed")

func readValidation(ctx context.Context, tx bun.Tx, id, actorID uuid.UUID, role Role) (ValidationRecord, error) {
	var row ValidationRecord
	query := tx.NewSelect().TableExpr("requests AS r").
		Join("JOIN submissions AS s ON s.id = r.submission_id").
		Join("JOIN projects AS p ON p.id = r.project_id").
		Join("JOIN project_versions AS v ON v.id = r.version_id").
		Join("JOIN user_accounts AS u ON u.id = s.subject_user_id").
		ColumnExpr("r.id, r.project_id, p.name AS project_name, s.subject_user_id, u.userid, u.name AS user_name, v.version, r.state, r.status, s.content_hash, r.duration_ms, r.requested_at, r.submission_id, r.version_id, r.attempt_count").
		Where("r.id = ? AND s.kind = ?", id, ValidationKind)
	if role == RoleStudent {
		query.Where("s.subject_user_id = ?", actorID).Where("p.published_at <= CURRENT_TIMESTAMP")
	}
	err := query.Scan(ctx, &row)
	if errors.Is(err, sql.ErrNoRows) {
		return row, ErrNotFound
	}
	return row, err
}

func readValidationResource(ctx context.Context, tx bun.Tx, row ValidationRecord) (resource.Resource, error) {
	var version ProjectVersion
	err := tx.NewSelect().Model(&version).Column("resource_json").
		Where("id = ? AND project_id = ?", row.VersionID, row.ProjectID).Scan(ctx)
	return version.ResourceJSON, err
}

func (s *RequestStore) GetValidation(ctx context.Context, id, actorID uuid.UUID, role Role) (ValidationDetail, error) {
	var detail ValidationDetail
	err := s.db.RunInTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true}, func(ctx context.Context, tx bun.Tx) error {
		var err error
		detail.ValidationRecord, err = readValidation(ctx, tx, id, actorID, role)
		if err != nil || detail.State != CompletedState {
			return err
		}
		detail.Resource, err = readValidationResource(ctx, tx, detail.ValidationRecord)
		if err != nil {
			return err
		}
		if err := tx.NewSelect().Model(&detail.Results).Where("request_id = ?", id).Scan(ctx); err != nil {
			return err
		}
		return tx.NewSelect().Table("artifacts").
			ColumnExpr("workflow_id, job_id, name, octet_length(content)::bigint AS size_bytes, error").
			Where("request_id = ? AND attempt_count = ?", id, detail.AttemptCount).
			Scan(ctx, &detail.Artifacts)
	})
	return detail, err
}

func (s *RequestStore) GetValidationFiles(ctx context.Context, id, actorID uuid.UUID, role Role) (ValidationFiles, error) {
	var files ValidationFiles
	err := s.db.RunInTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true}, func(ctx context.Context, tx bun.Tx) error {
		row, err := readValidation(ctx, tx, id, actorID, role)
		if err != nil {
			return err
		}
		files.Resource, err = readValidationResource(ctx, tx, row)
		if err != nil {
			return err
		}
		return tx.NewSelect().Model(&files.Submission).Where("submission_id = ?", row.SubmissionID).
			OrderExpr("path ASC").Scan(ctx)
	})
	return files, err
}

func (s *RequestStore) GetValidationArtifacts(ctx context.Context, id, actorID uuid.UUID, role Role) (ValidationArtifacts, error) {
	var files ValidationArtifacts
	err := s.db.RunInTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true}, func(ctx context.Context, tx bun.Tx) error {
		row, err := readValidation(ctx, tx, id, actorID, role)
		if err != nil {
			return err
		}
		if row.State != CompletedState {
			return ErrRequestNotCompleted
		}
		files.Resource, err = readValidationResource(ctx, tx, row)
		if err != nil {
			return err
		}
		query := tx.NewSelect().Model(&files.Files).
			Where("request_id = ? AND attempt_count = ? AND error IS NULL", id, row.AttemptCount)
		// Filter before fetching bytea, including for Managers and Admins.
		query.WhereGroup(" AND ", func(q *bun.SelectQuery) *bun.SelectQuery {
			q.Where("FALSE")
			for workflowID, workflow := range files.Resource.Workflows {
				for jobID, job := range workflow.Jobs {
					if job.Visibility != "public" || job.Artifacts == nil {
						continue
					}
					for _, output := range job.Artifacts.Outputs {
						if output.Visibility == "public" {
							q.WhereOr("(workflow_id = ? AND job_id = ? AND name = ?)", workflowID, jobID, output.Name)
						}
					}
				}
			}
			return q
		})
		return query.OrderExpr("workflow_id ASC, job_id ASC, name ASC").Scan(ctx)
	})
	return files, err
}
