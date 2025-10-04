package model

import (
	"context"
	"time"

	"github.com/dsa-uts/dsa-project/database/model/userrole"
	"github.com/uptrace/bun"
)

type UserRole struct {
	bun.BaseModel `bun:"table:userrole"`

	ID   userrole.Role     `bun:"id,pk,autoincrement" json:"id"`
	Name userrole.RoleName `bun:"name,notnull" json:"name"`
}

type UserList struct {
	bun.BaseModel `bun:"table:userlist"`

	ID             int64         `bun:",pk,autoincrement" json:"id"`
	UserID         string        `bun:"userid,type:varchar(255),notnull,unique" json:"userid"`
	Name           string        `bun:"name,type:varchar(255),notnull" json:"name"`
	HashedPassword string        `bun:"hashed_password,type:varchar(255),notnull" json:"hashed_password"`
	RoleID         userrole.Role `bun:"role_id,notnull" json:"role_id"`
	DisabledAt     time.Time     `bun:"disabled_at,notnull" json:"disabled_at"`
	Email          *string       `bun:"email,type:varchar(255)" json:"email,omitempty"`

	UserRole *UserRole `bun:"rel:has-one,join:role_id=id"`
}

type LoginHistory struct {
	bun.BaseModel `bun:"table:loginhistory"`

	ID       int64     `bun:",pk,autoincrement" json:"id"`
	UserID   string    `bun:"user_id,notnull" json:"user_id"`
	LoginAt  time.Time `bun:"login_at,notnull" json:"login_at"`
	LogoutAt time.Time `bun:"logout_at,notnull" json:"logout_at"`

	User *UserList `bun:"rel:belongs-to,join:user_id=userid"`
}

// This line is just for validating we do implement BeforeAppendModel method with correct args at compile time.
// Therefore, this line does not affect its logic.
var _ bun.BeforeAppendModelHook = (*UserList)(nil)

func (u *UserList) BeforeAppendModel(ctx context.Context, query bun.Query) error {
	switch query.(type) {
	case *bun.InsertQuery, *bun.UpdateQuery:
		// remove fraction less than seconds (milliseconds, microeconds, ...)
		u.DisabledAt = u.DisabledAt.Truncate(time.Second)
	}
	return nil
}

var _ bun.BeforeAppendModelHook = (*LoginHistory)(nil)

func (h *LoginHistory) BeforeAppendModel(ctx context.Context, query bun.Query) error {
	switch query.(type) {
	case *bun.InsertQuery, *bun.UpdateQuery:
		// remove fraction less than seconds (milliseconds, microeconds, ...)
		h.LoginAt = h.LoginAt.Truncate(time.Second)
		h.LogoutAt = h.LogoutAt.Truncate(time.Second)
	}
	return nil
}
