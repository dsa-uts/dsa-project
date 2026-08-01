package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// Role は User Account の権限レベル (CONTEXT.md「Role」)。
// DB の CHECK 制約 (migrations) と openapi.yaml の enum が正。
type Role string

const (
	RoleStudent Role = "student"
	RoleManager Role = "manager"
	RoleAdmin   Role = "admin"
)

// User は User Account の永続化レコード。disabled = true は
// Disabled User Account (soft delete、ログイン不可) を表す。
type User struct {
	bun.BaseModel `bun:"table:users"`

	ID           uuid.UUID `bun:"id,pk,default:gen_random_uuid()"`
	Userid       string    `bun:"userid,notnull"`
	Name         string    `bun:"name,notnull"`
	Role         Role      `bun:"role,notnull"`
	PasswordHash string    `bun:"password_hash,notnull"`
	Disabled     bool      `bun:"disabled,notnull,default:false"`
	CreatedAt    time.Time `bun:"created_at,notnull,default:now()"`
}

// UserStore is a concrete store (ADR 0011: no repository interfaces).
type UserStore struct {
	db *bun.DB
}

func NewUserStore(db *bun.DB) *UserStore {
	return &UserStore{db: db}
}

// GetByUserid returns the user with the given login userid.
// 見つからない場合は sql.ErrNoRows を返す。
func (s *UserStore) GetByUserid(ctx context.Context, userid string) (*User, error) {
	u := new(User)
	if err := s.db.NewSelect().Model(u).Where("userid = ?", userid).Scan(ctx); err != nil {
		return nil, err
	}
	return u, nil
}

// GetByID returns the user with the given ID. 見つからない場合は sql.ErrNoRows。
func (s *UserStore) GetByID(ctx context.Context, id uuid.UUID) (*User, error) {
	u := new(User)
	if err := s.db.NewSelect().Model(u).Where("id = ?", id).Scan(ctx); err != nil {
		return nil, err
	}
	return u, nil
}
