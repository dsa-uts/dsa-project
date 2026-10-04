package store

import (
	"context"
	"database/sql"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type ValidationFilter struct {
	ProjectID  *uuid.UUID
	Status     *Status
	Incomplete bool
	Next       *uuid.UUID
	Prev       *uuid.UUID
}

type ValidationSummary struct {
	ID            uuid.UUID
	ProjectID     uuid.UUID
	ProjectName   string
	SubjectUserID uuid.UUID
	Userid        string
	UserName      string
	Version       string
	State         RequestState
	Status        *Status
	ContentHash   string
	DurationMS    *int64
	RequestedAt   time.Time
}

type ValidationPage struct {
	Requests []ValidationSummary
	Next     *uuid.UUID
	Prev     *uuid.UUID
}

// ListValidation reads rows and navigation boundaries from one snapshot. Each
// subsequent HTTP request sees current data, including state and visibility changes.
func (s *RequestStore) ListValidation(ctx context.Context, actorID uuid.UUID, role Role, filter ValidationFilter) (ValidationPage, error) {
	page := ValidationPage{Requests: []ValidationSummary{}}
	err := s.db.RunInTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true}, func(ctx context.Context, tx bun.Tx) error {
		if filter.ProjectID != nil {
			query := tx.NewSelect().TableExpr("projects AS p").Where("p.id = ?", *filter.ProjectID)
			if role == RoleStudent {
				query.Where("p.published_at <= CURRENT_TIMESTAMP")
			}
			exists, err := query.Exists(ctx)
			if err != nil {
				return err
			}
			if !exists {
				return ErrNotFound
			}
		}
		matching := func() *bun.SelectQuery {
			query := tx.NewSelect().TableExpr("requests AS r").
				Join("JOIN submissions AS s ON s.id = r.submission_id").
				Join("JOIN projects AS p ON p.id = r.project_id").
				Where("s.kind = ?", ValidationKind)
			if role == RoleStudent {
				query.Where("s.subject_user_id = ?", actorID).Where("p.published_at <= CURRENT_TIMESTAMP")
			}
			if filter.ProjectID != nil {
				query.Where("r.project_id = ?", *filter.ProjectID)
			}
			if filter.Status != nil {
				query.Where("r.status = ?", *filter.Status)
			}
			if filter.Incomplete {
				query.Where("r.state IN ('pending', 'running', 'retrying')")
			}
			return query
		}
		query := matching().
			Join("JOIN user_accounts AS u ON u.id = s.subject_user_id").
			Join("JOIN project_versions AS v ON v.id = r.version_id").
			ColumnExpr("r.id, r.project_id, p.name AS project_name, s.subject_user_id, u.userid, u.name AS user_name, v.version, r.state, r.status, s.content_hash, r.duration_ms, r.requested_at").
			Limit(20)
		if filter.Prev != nil {
			query.Where("r.id > ?", *filter.Prev).OrderExpr("r.id ASC")
		} else {
			if filter.Next != nil {
				query.Where("r.id < ?", *filter.Next)
			}
			query.OrderExpr("r.id DESC")
		}
		if err := query.Scan(ctx, &page.Requests); err != nil {
			return err
		}
		if len(page.Requests) == 0 {
			return nil
		}
		if filter.Prev != nil {
			slices.Reverse(page.Requests)
		}
		first, last := page.Requests[0].ID, page.Requests[len(page.Requests)-1].ID
		older, err := matching().Where("r.id < ?", last).Exists(ctx)
		if err != nil {
			return err
		}
		newer, err := matching().Where("r.id > ?", first).Exists(ctx)
		if err != nil {
			return err
		}
		if older {
			page.Next = &last
		}
		if newer {
			page.Prev = &first
		}
		return nil
	})
	return page, err
}
