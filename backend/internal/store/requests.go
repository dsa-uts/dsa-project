package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"slices"
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

type Status string

const (
	IE   Status = "IE"
	CE   Status = "CE"
	OLE  Status = "OLE"
	MLE  Status = "MLE"
	TLE  Status = "TLE"
	RE   Status = "RE"
	WA   Status = "WA"
	SKIP Status = "SKIP"
	AC   Status = "AC"
)

func (s Status) Rank() int {
	switch s {
	case AC:
		return 0
	case SKIP:
		return 1
	case WA:
		return 2
	case RE:
		return 3
	case TLE:
		return 4
	case MLE:
		return 5
	case OLE:
		return 6
	case CE:
		return 7
	case IE:
		return 8
	default:
		return -1
	}
}

type Request struct {
	bun.BaseModel `bun:"table:requests"`

	ID               uuid.UUID    `bun:"id,pk,default:uuidv7()"`
	ProjectID        uuid.UUID    `bun:"project_id,notnull"`
	SubmissionID     uuid.UUID    `bun:"submission_id,notnull"`
	VersionID        uuid.UUID    `bun:"version_id,notnull"`
	RequestedBy      uuid.UUID    `bun:"requested_by,notnull"`
	RequestedAt      time.Time    `bun:"requested_at,notnull,default:now()"`
	State            RequestState `bun:"state,notnull,default:'pending'"`
	Status           *Status      `bun:"status"`
	LeaseOwner       *uuid.UUID   `bun:"lease_owner"`
	LeaseExpiresAt   *time.Time   `bun:"lease_expires_at"`
	AttemptCount     int32        `bun:"attempt_count,notnull,default:0"`
	AttemptStartedAt *time.Time   `bun:"attempt_started_at"`
	DurationMS       *int64       `bun:"duration_ms"`
	Error            *string      `bun:"error"`
}

type WorkflowResult struct {
	bun.BaseModel `bun:"table:workflow_results"`

	RequestID  uuid.UUID       `bun:"request_id,pk"`
	WorkflowID string          `bun:"workflow_id,pk"`
	Status     Status          `bun:"status"`
	DurationMS int64           `bun:"duration_ms"`
	Details    WorkflowDetails `bun:"details,type:jsonb,notnull"`
}

type WorkflowDetails struct {
	Jobs []JobResult `json:"jobs"`
}

type JobResult struct {
	ID         string       `json:"id"`
	Status     Status       `json:"status"`
	SkipReason string       `json:"skip_reason"`
	Steps      []StepResult `json:"steps"`
}

type StepResult struct {
	ID              string `json:"id"`
	Status          Status `json:"status"`
	ExitCode        int    `json:"exit_code"`
	DurationMS      int64  `json:"duration_ms"`
	Stdout          string `json:"stdout"`
	Stderr          string `json:"stderr"`
	StdoutTruncated bool   `json:"stdout_truncated"`
	StderrTruncated bool   `json:"stderr_truncated"`
}

type RequestStore struct{ db *bun.DB }

func NewRequestStore(db *bun.DB) *RequestStore {
	return &RequestStore{db: db}
}

var (
	ErrSubmissionOwner = errors.New("submission_owner_mismatch")
	ErrSubmissionScope = errors.New("submission_scope_mismatch")
	ErrLeaseLost       = errors.New("request lease lost")
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
				for _, file := range files {
					content := file.Content
					if content == nil {
						content = []byte{} // 空ファイルは SQL NULL ではなく空のbytea
					}

					// bun.Txではなくsql.Txを直接使う。
					// bun.Txを使うと一回クエリのフォーマットを挟むので、
					// その時にバイナリデータは16進リテラルに変換されてSQL文
					// に埋め込まれるので、ペイロードが倍になるから。
					// pgxドライバのCacheStatementモードでは、バイナリのまま送られる
					_, err := tx.Tx.ExecContext(ctx, `
					  INSERT INTO submission_files (submission_id, path, content)
						VALUES ($1, $2, $3::bytea)
					`, submission.ID, file.Path, content)
					if err != nil {
						return fmt.Errorf("save submission file %q: %w", file.Path, err)
					}
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

func (s *RequestStore) ClaimNext(
	ctx context.Context,
	ownerID uuid.UUID,
) (*Request, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		req := new(Request)
		err := s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
			err := tx.NewRaw(`
		  SELECT *
			FROM requests
			WHERE state IN ('pending', 'retrying')
			  OR (
					state = 'running'
					AND lease_expires_at <= statement_timestamp()
				)
			ORDER BY requested_at, id
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		`).Scan(ctx, req)
			if err != nil {
				return err
			}

			if req.State == RunningState {
				slog.WarnContext(ctx, "request lease expired",
					"request_id", req.ID,
					"previous_owner", *req.LeaseOwner,
					"lease_expires_at", *req.LeaseExpiresAt,
					"attempt_count", req.AttemptCount,
				)
			}

			// 最終試行で停止したRequestは、再取得せずIEで確定する。
			if req.AttemptCount >= 3 {
				return tx.NewRaw(`
			  UPDATE requests
				SET state = 'completed',
				    status = 'IE',
						lease_owner = NULL,
						lease_expires_at = NULL,
						duration_ms = NULL,
						error = 'request attempt limit reached'
				WHERE id = ?
				RETURNING *
			`, req.ID).Scan(ctx, req)
			}

			return tx.NewRaw(`
		  UPDATE requests
			SET state = 'running',
			    status = NULL,
					lease_owner = ?,
					lease_expires_at =
					    statement_timestamp() + INTERVAL '60 seconds',
					attempt_count = attempt_count + 1,
					attempt_started_at = statement_timestamp(),
					duration_ms = NULL,
					error = NULL
			WHERE id = ?
			RETURNING *
		`, ownerID, req.ID).Scan(ctx, req)
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, fmt.Errorf("claim next request: %w", err)
		}

		if req.State == CompletedState {
			// IEへの確定をコミット済み。次の候補を探す
			continue
		}
		return req, nil
	}
}

func (s *RequestStore) RenewLease(
	ctx context.Context,
	requestID, ownerID uuid.UUID,
	attemptCount int32,
) error {
	result, err := s.db.ExecContext(ctx, `
	  UPDATE requests
		SET lease_expires_at = clock_timestamp() + INTERVAL '60 seconds'
		WHERE id = ?
		  AND state = 'running'
			AND lease_owner = ?
			AND attempt_count = ?
			AND lease_expires_at > clock_timestamp()
	`, requestID, ownerID, attemptCount)
	if err != nil {
		return fmt.Errorf("renew lease: %w", err)
	}

	count, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("renew lease rows affected: %w", err)
	}
	if count == 0 {
		return ErrLeaseLost
	}
	return nil
}

func (s *RequestStore) FinishAttempt(
	ctx context.Context,
	requestID, ownerID uuid.UUID,
	attemptCount int32,
	results []WorkflowResult,
	executionErr error,
) error {
	state := CompletedState
	var status *Status
	var message *string

	if executionErr != nil && attemptCount < 3 {
		state = RetryingState
		// status = nil
		// message = nil
	} else {
		finalStatus := AC

		if executionErr != nil {
			// attemptCount >= 3
			finalStatus = IE
			text := executionErr.Error()
			message = &text
		} else {
			// executionErr == nil && attemptCount >= 3
			// or
			// executionErr == nil && attemptCount < 3

			// state = CompletedState
			// message = nil

			// executeは正常終了後、対象Workflowの全ての結果を返す
			if len(results) == 0 {
				return errors.New("cannot complete request without workflow results")
			}

			for _, result := range results {
				rank := result.Status.Rank()
				if rank < 0 {
					return fmt.Errorf(
						"invalid workflow status %q", result.Status,
					)
				}
				if rank > finalStatus.Rank() {
					finalStatus = result.Status
				}
			}
		}

		status = &finalStatus
	}

	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		// ロックは結果保存・状態更新が完了するまで保持する
		var lockID uuid.UUID
		err := tx.NewRaw(`
		  SELECT id
			FROM requests
			WHERE id = ?
			  AND state = 'running'
				AND lease_owner = ?
				AND attempt_count = ?
				AND lease_expires_at > clock_timestamp()
			FOR UPDATE
		`, requestID, ownerID, attemptCount).
			Scan(ctx, &lockID)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrLeaseLost
		}
		if err != nil {
			return fmt.Errorf("lock request: %w", err)
		}

		if state == CompletedState && len(results) > 0 {
			// 呼び出し元のsliceは変更せず、保存先Requesetをここで設定する
			rows := slices.Clone(results)
			for i := range rows {
				rows[i].RequestID = requestID
			}
			if _, err := tx.NewInsert().Model(&rows).Exec(ctx); err != nil {
				return fmt.Errorf("save workflow results: %w", err)
			}
		}

		updated, err := tx.ExecContext(ctx, `
		  UPDATE requests
			SET state = ?,
			    status = ?,
			    error = ?,
			    duration_ms = CASE
			        WHEN ? = 'completed' THEN
					        GREATEST(
							        0,
									    FLOOR(EXTRACT(EPOCH FROM (
										      clock_timestamp() - attempt_started_at
									    )) * 1000)
							    )::bigint
					    ELSE NULL
			    END,
			    lease_owner = NULL,
			    lease_expires_at = NULL
			WHERE id = ?
			  AND state = 'running'
				AND lease_owner = ?
				AND attempt_count = ?
				AND lease_expires_at > clock_timestamp()
		`, state, status, message, state,
			requestID, ownerID, attemptCount)
		if err != nil {
			return fmt.Errorf("finish request: %w", err)
		}

		count, err := updated.RowsAffected()
		if err != nil {
			return fmt.Errorf("finish request rows affected: %w", err)
		}
		if count == 0 {
			return ErrLeaseLost
		}
		return nil
	})
}

type ExecutionInput struct {
	Submission Submission
	Version    ProjectVersion
	Files      []SubmissionFile
}

func (s *RequestStore) LoadExecutionInput(
	ctx context.Context,
	req *Request,
) (*ExecutionInput, error) {
	input := &ExecutionInput{
		Files: []SubmissionFile{},
	}

	if err := s.db.NewSelect().
		Model(&input.Submission).
		Where("id = ?", req.SubmissionID).
		Where("project_id = ?", req.ProjectID).
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("load submission: %w", err)
	}

	if err := s.db.NewSelect().
		Model(&input.Version).
		Where("id = ?", req.VersionID).
		Where("project_id = ?", req.ProjectID).
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("load resource version: %w", err)
	}

	if err := s.db.NewSelect().
		Model(&input.Files).
		Where("submission_id = ?", req.SubmissionID).
		OrderExpr("path ASC").
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("load submission files: %w", err)
	}

	return input, nil
}

func (s *RequestStore) DeletePreviousArtifacts(
	ctx context.Context,
	requestID, ownerID uuid.UUID,
	attemptCount int32,
) error {
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		var lockID uuid.UUID
		err := tx.NewRaw(`
		  SELECT id
			FROM requests
			WHERE id = ?
			  AND state = 'running'
				AND lease_owner = ?
				AND attempt_count = ?
				AND lease_expires_at > clock_timestamp()
		  FOR UPDATE
		`, requestID, ownerID, attemptCount).Scan(ctx, &lockID)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrLeaseLost
		}
		if err != nil {
			return fmt.Errorf("lock request: %w", err)
		}

		_, err = tx.ExecContext(ctx, `
		  DELETE FROM artifacts
			WHERE request_id = ?
			  AND attempt_count < ?
		`, requestID, attemptCount)
		if err != nil {
			return fmt.Errorf("delete artifacts: %w", err)
		}

		return nil
	})
}
