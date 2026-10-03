package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Artifact struct {
	bun.BaseModel `bun:"table:artifacts"`

	RequestID    uuid.UUID `bun:"request_id"`
	AttemptCount int32     `bun:"attempt_count"`
	WorkflowID   string    `bun:"workflow_id"`
	JobID        string    `bun:"job_id"`
	Name         string    `bun:"name"`
	Content      []byte    `bun:"content,type:bytea"`
	Executable   bool      `bun:"executable"`
	Error        *string   `bun:"error"`
}

func (s *RequestStore) LoadArtifact(
	ctx context.Context,
	req *Request,
	workflowID, jobID, name string,
) (*Artifact, error) {
	artifact := new(Artifact)
	err := s.db.NewSelect().Model(artifact).
		Where("request_id = ? AND attempt_count = ?", req.ID, req.AttemptCount).
		Where("workflow_id = ? AND job_id = ? AND name = ?", workflowID, jobID, name).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load artifact: %w", err)
	}
	return artifact, nil
}

// Every execution write takes the same Request lock as lease renewal and finish.
func lockExecution(ctx context.Context, tx bun.Tx, req *Request, ownerID uuid.UUID) error {
	var id uuid.UUID
	err := tx.NewRaw(`
		SELECT id FROM requests
		WHERE id = ? AND state = 'running'
		  AND lease_owner = ? AND attempt_count = ?
		  AND lease_expires_at > clock_timestamp()
		FOR UPDATE
	`, req.ID, ownerID, req.AttemptCount).Scan(ctx, &id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrLeaseLost
	}
	return err
}

func (s *RequestStore) SaveArtifact(
	ctx context.Context,
	req *Request,
	ownerID uuid.UUID,
	artifact Artifact,
) error {
	if artifact.Error == nil && artifact.Content == nil {
		artifact.Content = []byte{}
	}
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := lockExecution(ctx, tx, req, ownerID); err != nil {
			return err
		}
		// Use sql.Tx directly so bytea does not become an inline hex literal.
		_, err := tx.Tx.ExecContext(ctx, `
			INSERT INTO artifacts
			    (request_id, attempt_count, workflow_id, job_id, name, content, executable, error)
			VALUES ($1, $2, $3, $4, $5, $6::bytea, $7, $8)
			ON CONFLICT (request_id, attempt_count, workflow_id, job_id, name)
			DO UPDATE SET content = EXCLUDED.content,
			              executable = EXCLUDED.executable, error = EXCLUDED.error
		`, req.ID, req.AttemptCount, artifact.WorkflowID, artifact.JobID,
			artifact.Name, artifact.Content, artifact.Executable, artifact.Error)
		return err
	})
}
