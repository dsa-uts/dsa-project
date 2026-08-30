package store

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

var ErrNotFound = errors.New("not found")

type UserAccount struct {
	bun.BaseModel `bun:"table:user_accounts"`

	ID           uuid.UUID  `bun:"id,pk,default:gen_random_uuid()"`
	Userid       string     `bun:"userid,notnull"`
	Name         string     `bun:"name,notnull"`
	Role         string     `bun:"role,notnull"`
	PasswordHash *string    `bun:"password_hash"`
	DisabledAt   *time.Time `bun:"disabled_at"`
	IsSystem     bool       `bun:"is_system,notnull"`
}

type Session struct {
	bun.BaseModel `bun:"table:sessions"`

	ID            uuid.UUID `bun:"id,pk,default:gen_random_uuid()"`
	UserAccountID uuid.UUID `bun:"user_account_id,notnull"`
	TokenHash     []byte    `bun:"token_hash,notnull"`
	ExpiresAt     time.Time `bun:"expires_at,notnull"`
	CreatedAt     time.Time `bun:"created_at,notnull,default:now()"`
}

type AuthStore struct{ db *bun.DB }

func NewAuthStore(db *bun.DB) *AuthStore { return &AuthStore{db: db} }

func (s *AuthStore) FindUserForLogin(ctx context.Context, userid string) (*UserAccount, error) {
	user := new(UserAccount)
	err := s.db.NewSelect().Model(user).Where("userid = ?", userid).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return user, err
}

func (s *AuthStore) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.db.NewDelete().Model((*Session)(nil)).Where("token_hash = ?", tokenHash).Exec(ctx)
	return err
}

func (s *AuthStore) ReplaceSession(ctx context.Context, previousHash []byte, userID uuid.UUID, tokenHash []byte, expiresAt time.Time) error {
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if len(previousHash) > 0 {
			if _, err := tx.NewDelete().Model((*Session)(nil)).Where("token_hash = ?", previousHash).Exec(ctx); err != nil {
				return err
			}
		}
		_, err := tx.NewInsert().Model(&Session{UserAccountID: userID, TokenHash: tokenHash, ExpiresAt: expiresAt}).Exec(ctx)
		return err
	})
}

func (s *AuthStore) CurrentUser(ctx context.Context, tokenHash []byte, now time.Time) (*UserAccount, error) {
	user := new(UserAccount)
	err := s.db.NewSelect().Model(user).
		Join("JOIN sessions AS session ON session.user_account_id = user_account.id").
		Where("session.token_hash = ?", tokenHash).
		Where("session.expires_at > ?", now).
		Where("user_account.disabled_at IS NULL").
		Scan(ctx)
	if err == nil {
		return user, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	var expired bool
	err = s.db.NewSelect().Model((*Session)(nil)).ColumnExpr("expires_at <= ?", now).
		Where("token_hash = ?", tokenHash).Scan(ctx, &expired)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if expired {
		if err := s.DeleteSession(ctx, tokenHash); err != nil {
			return nil, err
		}
	}
	return nil, ErrNotFound
}
