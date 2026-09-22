package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"golang.org/x/mod/semver"
)

type Project struct {
	bun.BaseModel `bun:"table:projects"`

	ID              uuid.UUID  `bun:"id,pk,default:gen_random_uuid()"`
	ResourceID      string     `bun:"resource_id,notnull"`
	Name            string     `bun:"name,notnull"`
	LatestVersionID uuid.UUID  `bun:"latest_version_id,notnull"`
	PublishedAt     *time.Time `bun:"published_at"`
	Deadline        *time.Time `bun:"deadline"`
	DisplayOrder    int64      `bun:"display_order,autoincrement"`
}

type ProjectStore struct{ db *bun.DB }

func NewProjectStore(db *bun.DB) *ProjectStore { return &ProjectStore{db: db} }

var (
	ErrProjectIDsMismatch   = errors.New("project_ids_mismatch")
	ErrOlderResourceVersion = errors.New("older_resource_version")
)

type ProjectLatest struct {
	Project
	Version      string          `bun:"version"`
	ResourceJSON json.RawMessage `bun:"resource_json,type:json"`
}

func (s *ProjectStore) ListProjects(ctx context.Context, publishedOnly bool) ([]ProjectLatest, error) {
	projects := []ProjectLatest{}
	query := s.db.NewSelect().TableExpr("projects AS p").
		ColumnExpr("p.*, v.version, v.resource_json").
		Join("JOIN project_versions AS v ON v.id = p.latest_version_id").OrderExpr("p.display_order ASC")
	if publishedOnly {
		query = query.Where("p.published_at <= CURRENT_TIMESTAMP")
	}
	err := query.Scan(ctx, &projects)
	return projects, err
}

// GetProject applies the same publication boundary as ListProjects.
func (s *ProjectStore) GetProject(ctx context.Context, id uuid.UUID, publishedOnly bool) (*ProjectLatest, error) {
	project := new(ProjectLatest)
	query := s.db.NewSelect().TableExpr("projects AS p").
		ColumnExpr("p.*, v.version, v.resource_json").
		Join("JOIN project_versions AS v ON v.id = p.latest_version_id").
		Where("p.id = ?", id)
	if publishedOnly {
		query = query.Where("p.published_at <= CURRENT_TIMESTAMP")
	}
	if err := query.Scan(ctx, project); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return project, nil
}

func (s *ProjectStore) CurrentVersion(ctx context.Context, resourceID string) (*ProjectLatest, error) {
	project := new(ProjectLatest)
	err := s.db.NewSelect().TableExpr("projects AS p").ColumnExpr("p.*, v.version").
		Join("JOIN project_versions AS v ON v.id = p.latest_version_id").
		Where("p.resource_id = ?", resourceID).Scan(ctx, project)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return project, err
}

type ProjectUpdate struct {
	ID          uuid.UUID
	PublishedAt *time.Time
	Deadline    *time.Time
}

func (s *ProjectStore) UpdateProjects(ctx context.Context, updates []ProjectUpdate) error {
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		// ponytail: table-level serialization for a small course; use per-Project
		// locking if concurrent administrative writes become significant.
		if _, err := tx.ExecContext(ctx, "LOCK TABLE projects IN SHARE ROW EXCLUSIVE MODE"); err != nil {
			return err
		}
		projects := []Project{}
		if err := tx.NewSelect().Model(&projects).OrderExpr("display_order ASC").Scan(ctx); err != nil {
			return err
		}
		if len(updates) != len(projects) {
			return ErrProjectIDsMismatch
		}
		remaining := make(map[uuid.UUID]bool, len(projects))
		for _, p := range projects {
			remaining[p.ID] = true
		}
		for _, u := range updates {
			if !remaining[u.ID] {
				return ErrProjectIDsMismatch
			}
			delete(remaining, u.ID)
		}
		if _, err := tx.ExecContext(ctx, "SET CONSTRAINTS projects_display_order_key DEFERRED"); err != nil {
			return err
		}
		for i, u := range updates {
			// Reuse sequence positions so subsequent imports still append.
			if _, err := tx.NewUpdate().Model((*Project)(nil)).
				Set("published_at = ?", u.PublishedAt).Set("deadline = ?", u.Deadline).
				Set("display_order = ?", projects[i].DisplayOrder).Where("id = ?", u.ID).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}

// ImportVersion receives an already validated snapshot. Fetching never holds a DB lock.
func (s *ProjectStore) ImportVersion(ctx context.Context, resourceID, name, version string, snapshot json.RawMessage) (*ProjectLatest, bool, error) {
	project := new(ProjectLatest)
	changed := false
	err := s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		// Share the bulk-update lock, including first imports without an existing row.
		if _, err := tx.ExecContext(ctx, "LOCK TABLE projects IN SHARE ROW EXCLUSIVE MODE"); err != nil {
			return err
		}
		err := tx.NewSelect().TableExpr("projects AS p").ColumnExpr("p.*, v.version").
			Join("JOIN project_versions AS v ON v.id = p.latest_version_id").
			Where("p.resource_id = ?", resourceID).Scan(ctx, project)
		isNew := errors.Is(err, sql.ErrNoRows)
		if err != nil && !isNew {
			return err
		}
		if !isNew {
			switch semver.Compare(version, project.Version) {
			case -1:
				return ErrOlderResourceVersion
			case 0:
				return nil
			}
		} else {
			project.ID = uuid.New()
			project.ResourceID = resourceID
		}
		project.LatestVersionID = uuid.New()
		project.Name = name
		project.Version = version
		if isNew {
			if _, err := tx.NewInsert().Model(&project.Project).Exec(ctx); err != nil {
				return err
			}
		} else {
			if _, err := tx.NewUpdate().Model(&project.Project).Column("name", "latest_version_id").WherePK().Exec(ctx); err != nil {
				return err
			}
		}
		v := &ProjectVersion{ID: project.LatestVersionID, ProjectID: project.ID, Version: version, ResourceJSON: snapshot}
		if _, err := tx.NewInsert().Model(v).Exec(ctx); err != nil {
			return err
		}
		changed = true
		return nil
	})
	return project, changed, err
}

// ProjectVersion stores a validated Resource snapshot, including private data.
// API responses must select visible fields rather than expose ResourceJSON.
type ProjectVersion struct {
	bun.BaseModel `bun:"table:project_versions"`

	ID           uuid.UUID       `bun:"id,pk,default:gen_random_uuid()"`
	ProjectID    uuid.UUID       `bun:"project_id,notnull"`
	Version      string          `bun:"version,notnull"`
	ResourceJSON json.RawMessage `bun:"resource_json,type:json,notnull"`
	RegisteredAt time.Time       `bun:"registered_at,notnull,default:now()"`
}
