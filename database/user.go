package database

import (
	"context"
	"fmt"
	"time"

	"github.com/dsa-uts/dsa-project/database/model"
	"github.com/dsa-uts/dsa-project/database/model/userrole"
	"github.com/uptrace/bun"
)

type UserStore struct {
	db *bun.DB
}

func (us UserStore) UpdateLogoutTime(ctx context.Context, userid string, login_at time.Time, logout_at time.Time) error {
	_, err := us.db.NewUpdate().Model(&model.LoginHistory{}).
		Set("logout_at = ?", logout_at).
		Where("user_id = ? AND login_at = ?", userid, login_at).
		Exec(ctx)
	return err
}

func NewUserStore(db *bun.DB) *UserStore {
	return &UserStore{
		db: db,
	}
}

func (us *UserStore) GetIDByUserID(ctx context.Context, user_id string) (*int64, error) {
	var id int64
	err := us.db.NewSelect().Model((*model.UserList)(nil)).Column("id").Where("userid = ?", user_id).Scan(ctx, &id)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func (us *UserStore) GetUserByUserID(ctx context.Context, user_id string) (*model.UserList, error) {
	var users []model.UserList

	err := us.db.NewSelect().Model(&users).Relation("UserRole").Where("userid = ?", user_id).Scan(ctx)

	if err != nil {
		return nil, err
	}

	if len(users) == 0 {
		return nil, nil // User not found
	}

	if len(users) > 1 {
		panic(fmt.Sprintf("multiple users found with userid %s, that should not happen", user_id)) // should not happen
	}

	return &users[0], err
}

func (us *UserStore) GetUserListByUserRole(ctx context.Context, role userrole.Role) (*[]model.UserList, error) {
	var users []model.UserList

	err := us.db.NewSelect().Model(&users).Where("role_id = ?", role).Scan(ctx)
	if err != nil {
		return nil, err
	}

	return &users, nil
}

func (us *UserStore) CreateUser(ctx context.Context, user *model.UserList) error {
	_, err := us.db.NewInsert().Model(user).Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}
	return nil
}

func (us *UserStore) GetLoginHistory(ctx context.Context, userID string, loginAt time.Time) (*model.LoginHistory, error) {
	var loginHistory model.LoginHistory

	err := us.db.NewSelect().Model(&loginHistory).
		Where("user_id = ? AND login_at = ?", userID, loginAt).
		Scan(ctx)

	if err != nil {
		return nil, fmt.Errorf("failed to get login history: %w", err)
	}

	return &loginHistory, nil
}

func (us *UserStore) RegisterLoginHistory(ctx context.Context, loginHistory *model.LoginHistory) error {
	_, err := us.db.NewInsert().Model(loginHistory).Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to register loginHistory: %w", err)
	}
	return nil
}

func (us *UserStore) GetAllUserList(ctx context.Context) (*[]model.UserList, error) {
	var users []model.UserList

	err := us.db.NewSelect().Model(&users).Order("id ASC").Scan(ctx)
	if err != nil {
		return nil, err
	}

	return &users, nil
}

func (us *UserStore) ExistsByUserID(ctx context.Context, userID string) (bool, error) {
	count, err := us.db.NewSelect().Model((*model.UserList)(nil)).Where("userid = ?", userID).Count(ctx)
	if err != nil {
		return false, fmt.Errorf("failed to check user existence: %w", err)
	}
	return count > 0, nil
}

func (us *UserStore) ModifyUserValidity(ctx context.Context, userID string, disabledAt time.Time) error {
	_, err := us.db.NewUpdate().Model((*model.UserList)(nil)).
		Set("disabled_at = ?", disabledAt).
		Where("userid = ?", userID).
		Exec(ctx)
	return err
}

func (us *UserStore) ModifyUserDetails(ctx context.Context, userID string, name *string, hashed_password *string, email *string, roleID *userrole.Role) error {
	update := us.db.NewUpdate().Model((*model.UserList)(nil)).Where("userid = ?", userID)

	if name != nil {
		update = update.Set("name = ?", *name)
	}
	if hashed_password != nil {
		update = update.Set("hashed_password = ?", *hashed_password)
	}
	if email != nil {
		update = update.Set("email = ?", email)
	}
	if roleID != nil {
		update = update.Set("role_id = ?", *roleID)
	}

	_, err := update.Exec(ctx)
	return err
}
