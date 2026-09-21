package store

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
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
