package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	echo "github.com/labstack/echo/v4"

	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/dsa-uts/dsa-project/backend/internal/server"
	"github.com/dsa-uts/dsa-project/backend/internal/testutil"
)

// do は full Echo server に 1 リクエストを流す (HTTP seam)。
// cookie 付きリクエストは cookies に渡す。
func do(e *echo.Echo, method, path, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

// sessionCookie extracts the session cookie from a response.
func sessionCookie(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Name == auth.CookieName {
			return c
		}
	}
	t.Fatalf("no %q cookie in response (headers: %v)", auth.CookieName, rec.Header())
	return nil
}

func TestHealth(t *testing.T) {
	e := server.New(nil, nil)
	rec := do(e, http.MethodGet, "/health", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /health: got status %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Body.String(); !strings.Contains(got, `"status":"ok"`) {
		t.Errorf("GET /health: body %q does not contain status ok", got)
	}
}

// ログイン → /api/me → ログアウト → /api/me の一連のセッションライフサイクル。
// dev seed の Admin (admin / password) を使う (issue #96)。
func TestSessionLifecycle(t *testing.T) {
	db := testutil.StartPostgres(t)
	rdb := testutil.StartRedis(t)
	e := server.New(db, rdb)

	// ログイン成功: User オブジェクトと session cookie が返る
	rec := do(e, http.MethodPost, "/api/session", `{"userid":"admin","password":"password"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/session: got status %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	var loggedIn struct {
		ID     string `json:"id"`
		Userid string `json:"userid"`
		Name   string `json:"name"`
		Role   string `json:"role"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &loggedIn); err != nil {
		t.Fatalf("POST /api/session: unmarshal body %q: %v", rec.Body.String(), err)
	}
	if loggedIn.Userid != "admin" || loggedIn.Role != "admin" || loggedIn.ID == "" {
		t.Errorf("POST /api/session: unexpected user %+v", loggedIn)
	}

	// cookie 属性: HttpOnly / Secure / SameSite=Lax (api.md Conventions)
	cookie := sessionCookie(t, rec)
	if cookie.Value == "" {
		t.Error("session cookie value should not be empty")
	}
	if !cookie.HttpOnly {
		t.Error("session cookie should be HttpOnly")
	}
	if !cookie.Secure {
		t.Error("session cookie should be Secure")
	}
	if cookie.SameSite != http.SameSiteLaxMode {
		t.Errorf("session cookie SameSite: got %v, want Lax", cookie.SameSite)
	}

	// /api/me: セッションで現在の User が引ける
	rec = do(e, http.MethodGet, "/api/me", "", cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/me: got status %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	var me struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &me); err != nil {
		t.Fatalf("GET /api/me: unmarshal body %q: %v", rec.Body.String(), err)
	}
	if me.ID != loggedIn.ID {
		t.Errorf("GET /api/me: got user id %q, want %q", me.ID, loggedIn.ID)
	}
	// sliding session: /api/me は cookie を再設定して有効期限を延ばす
	if refreshed := sessionCookie(t, rec); refreshed.MaxAge <= 0 {
		t.Errorf("GET /api/me: refreshed cookie Max-Age should be positive, got %d", refreshed.MaxAge)
	}

	// ログアウト: 204 + cookie 失効
	rec = do(e, http.MethodDelete, "/api/session", "", cookie)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE /api/session: got status %d, want %d (body: %s)", rec.Code, http.StatusNoContent, rec.Body.String())
	}
	if cleared := sessionCookie(t, rec); cleared.MaxAge >= 0 {
		t.Errorf("DELETE /api/session: cookie Max-Age should be negative to expire it, got %d", cleared.MaxAge)
	}

	// ログアウト後のセッションは無効
	rec = do(e, http.MethodGet, "/api/me", "", cookie)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /api/me after logout: got status %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

// userid 不存在とパスワード誤りが完全に同じレスポンスであること (401 invalid_credentials)。
func TestLoginInvalidCredentialsIndistinguishable(t *testing.T) {
	db := testutil.StartPostgres(t)
	rdb := testutil.StartRedis(t)
	e := server.New(db, rdb)

	wrongPassword := do(e, http.MethodPost, "/api/session", `{"userid":"admin","password":"wrong"}`)
	unknownUserid := do(e, http.MethodPost, "/api/session", `{"userid":"no-such-user","password":"password"}`)

	for name, rec := range map[string]*httptest.ResponseRecorder{
		"wrong password": wrongPassword,
		"unknown userid": unknownUserid,
	} {
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s: got status %d, want %d (body: %s)", name, rec.Code, http.StatusUnauthorized, rec.Body.String())
		}
		if got := rec.Body.String(); !strings.Contains(got, `"code":"invalid_credentials"`) {
			t.Errorf("%s: body %q does not contain invalid_credentials envelope", name, got)
		}
	}
	if wrongPassword.Body.String() != unknownUserid.Body.String() {
		t.Errorf("responses must be indistinguishable:\n wrong password: %s\n unknown userid: %s",
			wrongPassword.Body.String(), unknownUserid.Body.String())
	}
	// どちらも cookie を設定しない
	for _, rec := range []*httptest.ResponseRecorder{wrongPassword, unknownUserid} {
		if len(rec.Result().Cookies()) != 0 {
			t.Errorf("401 response must not set cookies, got %v", rec.Result().Cookies())
		}
	}
}

// Disabled User Account はログイン不可 (CONTEXT.md)。応答は invalid_credentials と同一。
func TestLoginDisabledUser(t *testing.T) {
	db := testutil.StartPostgres(t)
	rdb := testutil.StartRedis(t)
	e := server.New(db, rdb)

	// dev seed と同じハッシュ (password) を持つ disabled ユーザーを直接挿入する
	_, err := db.ExecContext(context.Background(),
		`INSERT INTO users (userid, name, role, password_hash, disabled)
		 SELECT 'disabled001', 'Disabled User', 'student', password_hash, true FROM users WHERE userid = 'admin'`)
	if err != nil {
		t.Fatalf("insert disabled user: %v", err)
	}

	rec := do(e, http.MethodPost, "/api/session", `{"userid":"disabled001","password":"password"}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("login as disabled user: got status %d, want %d (body: %s)", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
	if got := rec.Body.String(); !strings.Contains(got, `"code":"invalid_credentials"`) {
		t.Errorf("login as disabled user: body %q does not contain invalid_credentials envelope", got)
	}
}

// セッション期限切れ (Redis 側の TTL 失効) 後は 401。
func TestSessionExpiry(t *testing.T) {
	db := testutil.StartPostgres(t)
	rdb := testutil.StartRedis(t)
	e := server.New(db, rdb)

	rec := do(e, http.MethodPost, "/api/session", `{"userid":"admin","password":"password"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/session: got status %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	cookie := sessionCookie(t, rec)

	// TTL 失効を Redis 側でキーを消して再現する
	ctx := context.Background()
	if err := rdb.Del(ctx, auth.RedisKey(cookie.Value)).Err(); err != nil {
		t.Fatalf("expire session key: %v", err)
	}

	rec = do(e, http.MethodGet, "/api/me", "", cookie)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /api/me with expired session: got status %d, want %d (body: %s)", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
	if got := rec.Body.String(); !strings.Contains(got, `"error"`) {
		t.Errorf("expired session: body %q is not the error envelope", got)
	}
}

// sliding session: /api/me を叩くと Redis の TTL が SessionTTL に戻る。
func TestSessionSlidingExpiration(t *testing.T) {
	db := testutil.StartPostgres(t)
	rdb := testutil.StartRedis(t)
	e := server.New(db, rdb)

	rec := do(e, http.MethodPost, "/api/session", `{"userid":"admin","password":"password"}`)
	cookie := sessionCookie(t, rec)
	key := auth.RedisKey(cookie.Value)

	// TTL を意図的に縮めてから /api/me でアクセスする
	ctx := context.Background()
	if err := rdb.Expire(ctx, key, time.Minute).Err(); err != nil {
		t.Fatalf("shorten session ttl: %v", err)
	}

	if rec := do(e, http.MethodGet, "/api/me", "", cookie); rec.Code != http.StatusOK {
		t.Fatalf("GET /api/me: got status %d, want %d", rec.Code, http.StatusOK)
	}

	ttl, err := rdb.TTL(ctx, key).Result()
	if err != nil {
		t.Fatalf("read session ttl: %v", err)
	}
	if ttl <= time.Minute {
		t.Errorf("session TTL should be extended by access, got %v", ttl)
	}
}

// 未認証アクセス: セッション無しの /api/me は 401 (認証はストア不要で判断できる)。
func TestMeUnauthenticated(t *testing.T) {
	e := server.New(nil, nil)
	rec := do(e, http.MethodGet, "/api/me", "")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /api/me without session: got status %d, want %d (body: %s)", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
	if got := rec.Body.String(); !strings.Contains(got, `"code":"unauthenticated"`) {
		t.Errorf("GET /api/me without session: body %q does not contain unauthenticated envelope", got)
	}
}

// ログアウトの冪等性: セッションが無くても 204 (api.md)。
func TestLogoutWithoutSession(t *testing.T) {
	e := server.New(nil, nil)
	rec := do(e, http.MethodDelete, "/api/session", "")

	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE /api/session without session: got status %d, want %d (body: %s)", rec.Code, http.StatusNoContent, rec.Body.String())
	}
	if cleared := sessionCookie(t, rec); cleared.MaxAge >= 0 {
		t.Errorf("cookie Max-Age should be negative to expire it, got %d", cleared.MaxAge)
	}
}

// kin-openapi validation middleware が spec の required / minLength を強制し、
// api.md の 422 エラー封筒で返すことを検証する。
func TestLoginValidationError(t *testing.T) {
	e := server.New(nil, nil) // バリデーションは handler より手前なのでストア不要

	for name, body := range map[string]string{
		"missing fields": `{}`,
		"empty userid":   `{"userid":"","password":"x"}`,
		"empty password": `{"userid":"admin","password":""}`,
	} {
		rec := do(e, http.MethodPost, "/api/session", body)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("%s: got status %d, want %d (body: %s)", name, rec.Code, http.StatusUnprocessableEntity, rec.Body.String())
		}
		if got := rec.Body.String(); !strings.Contains(got, `"code":"validation_failed"`) {
			t.Errorf("%s: body %q does not contain validation_failed envelope", name, got)
		}
	}
}

// DATABASE_URL / REDIS_URL 未設定で起動した場合 (chart に datastores が無い間の妥協)。
func TestLoginStoreUnavailable(t *testing.T) {
	e := server.New(nil, nil)
	rec := do(e, http.MethodPost, "/api/session", `{"userid":"admin","password":"password"}`)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("POST /api/session without stores: got status %d, want %d (body: %s)", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}
	if got := rec.Body.String(); !strings.Contains(got, `"code":"store_unavailable"`) {
		t.Errorf("POST /api/session without stores: body %q does not contain store_unavailable envelope", got)
	}
}

// spec 外のルートでもエラーが統一封筒で返ることを検証する。
func TestNotFoundEnvelope(t *testing.T) {
	e := server.New(nil, nil)
	rec := do(e, http.MethodGet, "/api/nonexistent", "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET /api/nonexistent: got status %d, want %d", rec.Code, http.StatusNotFound)
	}
	if got := rec.Body.String(); !strings.Contains(got, `"code":"not_found"`) {
		t.Errorf("GET /api/nonexistent: body %q does not contain not_found envelope", got)
	}
}
