// Package auth owns the backend-managed session cookie: Redis-backed session
// storage and the middleware that resolves the cookie into the current User。
// Role ごとの認可はエンドポイント側 (handler) の責務。
package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// CookieName is the session cookie name (openapi.yaml の cookieAuth と一致)。
const CookieName = "session"

// SessionTTL is the sliding expiration: アクセスのたびに延長される。
const SessionTTL = 7 * 24 * time.Hour

// RedisKey is the Redis key that stores the session for a token.
// テストが TTL や削除を直接観測するときもこれを使う (プレフィックスを重複させない)。
func RedisKey(token string) string {
	return "session:" + token
}

// SessionStore keeps sessions in Redis (docs/spec/README.md: セッションは Redis)。
// value は User の UUID、TTL は SessionTTL の sliding expiration。
type SessionStore struct {
	rdb *redis.Client
}

func NewSessionStore(rdb *redis.Client) *SessionStore {
	return &SessionStore{rdb: rdb}
}

// Create issues a new opaque session token for the user.
func (s *SessionStore) Create(ctx context.Context, userID uuid.UUID) (string, error) {
	// 256-bit random token。推測不能性はここだけで担保する。
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	if err := s.rdb.Set(ctx, RedisKey(token), userID.String(), SessionTTL).Err(); err != nil {
		return "", err
	}
	return token, nil
}

// Resolve returns the user ID for a token and slides its expiration.
// セッションが無い (未発行・期限切れ・削除済み) 場合は ok=false。
func (s *SessionStore) Resolve(ctx context.Context, token string) (uuid.UUID, bool, error) {
	val, err := s.rdb.GetEx(ctx, RedisKey(token), SessionTTL).Result()
	if errors.Is(err, redis.Nil) {
		return uuid.UUID{}, false, nil
	}
	if err != nil {
		return uuid.UUID{}, false, err
	}
	userID, err := uuid.Parse(val)
	if err != nil {
		return uuid.UUID{}, false, err
	}
	return userID, true, nil
}

// Delete removes the session. 存在しなくてもエラーにしない (ログアウトの冪等性)。
func (s *SessionStore) Delete(ctx context.Context, token string) error {
	return s.rdb.Del(ctx, RedisKey(token)).Err()
}

// NewCookie builds the session cookie (api.md Conventions:
// HttpOnly / Secure / SameSite=Lax)。
func NewCookie(token string) *http.Cookie {
	return &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(SessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	}
}

// ExpiredCookie builds the cookie that logs the browser out.
func ExpiredCookie() *http.Cookie {
	c := NewCookie("")
	c.MaxAge = -1
	return c
}
