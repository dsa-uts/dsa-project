package api

import (
	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

// Handler implements the generated StrictServerInterface.
type Handler struct {
	// nil のときは DB / Redis 未接続 (DATABASE_URL / REDIS_URL 未設定)。
	// chart にデータストアが入るまでの妥協で、該当エンドポイントは 500 を返す。
	users    *store.UserStore
	sessions *auth.SessionStore
}

var _ StrictServerInterface = (*Handler)(nil)

func NewHandler(users *store.UserStore, sessions *auth.SessionStore) *Handler {
	return &Handler{users: users, sessions: sessions}
}

// NewError builds the api.md unified error envelope.
func NewError(code, message string) Error {
	var e Error
	e.Error.Code = code
	e.Error.Message = message
	return e
}

func storeUnavailable() Error {
	return NewError("store_unavailable", "The server is running without its datastores.")
}

func apiUser(u *store.User) User {
	return User{Id: u.ID, Userid: u.Userid, Name: u.Name, Role: Role(u.Role)}
}
