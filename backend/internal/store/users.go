package store

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/driver/pgdriver"
)

var (
	ErrUseridTaken               = errors.New("userid_taken")
	ErrCannotModifySelf          = errors.New("cannot_modify_self")
	ErrCannotModifySystemAccount = errors.New("cannot_modify_system_account")
)

func (s *AuthStore) ListUsers(ctx context.Context) ([]UserAccount, error) {
	users := []UserAccount{}
	err := s.db.NewSelect().Model(&users).Where("is_system = false").OrderExpr("display_order ASC").Scan(ctx)
	return users, err
}

func (s *AuthStore) CreateUser(ctx context.Context, user *UserAccount) error {
	_, err := s.db.NewInsert().Model(user).Returning("*").Exec(ctx)
	if pgErr, ok := errors.AsType[pgdriver.Error](err); ok && pgErr.Field('C') == "23505" && pgErr.Field('n') == "user_accounts_userid_key" {
		return ErrUseridTaken
	}
	return err
}

type UserUpdate struct {
	Name         *string
	Role         *string
	PasswordHash *string
	Disabled     *bool
}

// UpdateUser locks the account shared with session creation. Only supplied fields
// are written; session invalidation and the account change commit together.
func (s *AuthStore) UpdateUser(ctx context.Context, actorID, userID uuid.UUID, update UserUpdate) (*UserAccount, error) {
	user := new(UserAccount)
	err := s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		err := tx.NewSelect().Model(user).Where("id = ?", userID).For("UPDATE").Scan(ctx)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if user.IsSystem {
			return ErrCannotModifySystemAccount
		}
		if actorID == userID && ((update.Role != nil && *update.Role != user.Role) || (update.Disabled != nil && *update.Disabled)) {
			return ErrCannotModifySelf
		}
		columns := []string{}
		if update.Name != nil {
			user.Name = *update.Name
			columns = append(columns, "name")
		}
		if update.Role != nil {
			user.Role = *update.Role
			columns = append(columns, "role")
		}
		invalidate := update.PasswordHash != nil
		if update.PasswordHash != nil {
			user.PasswordHash = update.PasswordHash
			columns = append(columns, "password_hash")
		}
		if update.Disabled != nil {
			if *update.Disabled && user.DisabledAt == nil {
				user.DisabledAt = new(time.Now())
				invalidate = true
			}
			if !*update.Disabled {
				user.DisabledAt = nil
			}
			columns = append(columns, "disabled_at")
		}
		if len(columns) > 0 {
			if _, err := tx.NewUpdate().Model(user).Column(columns...).WherePK().Exec(ctx); err != nil {
				return err
			}
		}
		if invalidate {
			if _, err := tx.NewDelete().Model((*Session)(nil)).Where("user_account_id = ?", userID).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
	return user, err
}
