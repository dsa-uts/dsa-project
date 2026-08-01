package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// Greeting は scaffolding 用ダミーエンドポイント (issue #95) の永続化レコード。
type Greeting struct {
	bun.BaseModel `bun:"table:greetings"`

	ID        uuid.UUID `bun:"id,pk,default:gen_random_uuid()"`
	Message   string    `bun:"message,notnull"`
	CreatedAt time.Time `bun:"created_at,notnull,default:now()"`
}

// GreetingStore is a concrete store (ADR 0011: no repository interfaces).
type GreetingStore struct {
	db *bun.DB
}

func NewGreetingStore(db *bun.DB) *GreetingStore {
	return &GreetingStore{db: db}
}

// Create persists a greeting; id と created_at は DB 側で採番される。
func (s *GreetingStore) Create(ctx context.Context, message string) (*Greeting, error) {
	g := &Greeting{Message: message}
	if _, err := s.db.NewInsert().Model(g).Returning("id, created_at").Exec(ctx); err != nil {
		return nil, err
	}
	return g, nil
}

// List returns all greetings, newest first.
func (s *GreetingStore) List(ctx context.Context) ([]Greeting, error) {
	var gs []Greeting
	if err := s.db.NewSelect().Model(&gs).OrderExpr("created_at DESC, id DESC").Scan(ctx); err != nil {
		return nil, err
	}
	return gs, nil
}
