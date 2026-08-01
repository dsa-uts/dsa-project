package auth

import (
	"context"
	"database/sql"
	"errors"

	echo "github.com/labstack/echo/v4"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

type contextKey int

const (
	tokenKey contextKey = iota
	userKey
)

// Middleware resolves the session cookie into the current User and stores
// both the raw token and the User in the request context. 認証を強制はしない:
// 未認証はそのまま通し、各 handler が 401 を判断する (エンドポイントごとの
// 認可は api.md がエンドポイント側に記載する方針のため)。
func Middleware(users *store.UserStore, sessions *SessionStore) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			cookie, err := c.Cookie(CookieName)
			if err != nil || cookie.Value == "" {
				return next(c)
			}
			ctx := context.WithValue(c.Request().Context(), tokenKey, cookie.Value)

			if sessions != nil && users != nil {
				if user, err := resolveUser(ctx, users, sessions, cookie.Value); err != nil {
					return err
				} else if user != nil {
					ctx = context.WithValue(ctx, userKey, user)
				}
			}

			c.SetRequest(c.Request().WithContext(ctx))
			return next(c)
		}
	}
}

// resolveUser loads the session's User. セッション不明・ユーザー不明・
// Disabled User Account (ログイン不可) は「未認証」として nil を返す。
func resolveUser(ctx context.Context, users *store.UserStore, sessions *SessionStore, token string) (*store.User, error) {
	userID, ok, err := sessions.Resolve(ctx, token)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil
	}
	user, err := users.GetByID(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if user.Disabled {
		return nil, nil
	}
	return user, nil
}

// CurrentUser returns the authenticated User, or nil when unauthenticated.
func CurrentUser(ctx context.Context) *store.User {
	user, _ := ctx.Value(userKey).(*store.User)
	return user
}

// SessionToken returns the raw session cookie value, valid or not.
// ログアウト (DELETE /api/session) が失効済みセッションでも冪等に動くために、
// 有効性と無関係に取り出せるようにしている。
func SessionToken(ctx context.Context) (string, bool) {
	token, ok := ctx.Value(tokenKey).(string)
	return token, ok
}
