package server_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	echo "github.com/labstack/echo/v4"

	"github.com/dsa-uts/dsa-project/backend/internal/server"
	"github.com/dsa-uts/dsa-project/backend/internal/testutil"
)

// do は full Echo server に 1 リクエストを流す (HTTP seam)。
func do(e *echo.Echo, method, path, body string) *httptest.ResponseRecorder {
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestHealth(t *testing.T) {
	e := server.New(nil)
	rec := do(e, http.MethodGet, "/health", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /health: got status %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Body.String(); !strings.Contains(got, `"status":"ok"`) {
		t.Errorf("GET /health: body %q does not contain status ok", got)
	}
}

// contract pipeline の貫通テスト: openapi.yaml → 生成ハンドラ → store → 実 PostgreSQL。
func TestHelloRoundTrip(t *testing.T) {
	db := testutil.StartPostgres(t)
	e := server.New(db)

	rec := do(e, http.MethodPost, "/api/hello", `{"name":"dsa"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /api/hello: got status %d, want %d (body: %s)", rec.Code, http.StatusCreated, rec.Body.String())
	}
	var created struct {
		ID        string `json:"id"`
		Message   string `json:"message"`
		CreatedAt string `json:"created_at"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("POST /api/hello: unmarshal body %q: %v", rec.Body.String(), err)
	}
	if created.Message != "hello, dsa" {
		t.Errorf("POST /api/hello: got message %q, want %q", created.Message, "hello, dsa")
	}
	if created.ID == "" || created.CreatedAt == "" {
		t.Errorf("POST /api/hello: id/created_at should be set by the DB, got %+v", created)
	}

	if rec := do(e, http.MethodPost, "/api/hello", `{"name":"second"}`); rec.Code != http.StatusCreated {
		t.Fatalf("POST /api/hello (second): got status %d, want %d", rec.Code, http.StatusCreated)
	}

	rec = do(e, http.MethodGet, "/api/hello", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/hello: got status %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	var list struct {
		Greetings []struct {
			ID      string `json:"id"`
			Message string `json:"message"`
		} `json:"greetings"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("GET /api/hello: unmarshal body %q: %v", rec.Body.String(), err)
	}
	if len(list.Greetings) != 2 {
		t.Fatalf("GET /api/hello: got %d greetings, want 2 (body: %s)", len(list.Greetings), rec.Body.String())
	}
	// 新しい順
	if list.Greetings[0].Message != "hello, second" || list.Greetings[1].Message != "hello, dsa" {
		t.Errorf("GET /api/hello: greetings not newest-first: %+v", list.Greetings)
	}
}

// kin-openapi validation middleware が spec の required / minLength を強制し、
// api.md の 422 エラー封筒で返すことを検証する。
func TestHelloValidationError(t *testing.T) {
	e := server.New(nil) // バリデーションは handler より手前なので DB 不要

	for name, body := range map[string]string{
		"missing name": `{}`,
		"empty name":   `{"name":""}`,
	} {
		rec := do(e, http.MethodPost, "/api/hello", body)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("%s: got status %d, want %d (body: %s)", name, rec.Code, http.StatusUnprocessableEntity, rec.Body.String())
		}
		if got := rec.Body.String(); !strings.Contains(got, `"code":"validation_failed"`) {
			t.Errorf("%s: body %q does not contain validation_failed envelope", name, got)
		}
	}
}

// DATABASE_URL 未設定で起動した場合 (chart に PostgreSQL が無い scaffolding 期の妥協) の挙動。
func TestHelloDatabaseUnavailable(t *testing.T) {
	e := server.New(nil)
	rec := do(e, http.MethodGet, "/api/hello", "")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("GET /api/hello without DB: got status %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if got := rec.Body.String(); !strings.Contains(got, `"code":"database_unavailable"`) {
		t.Errorf("GET /api/hello without DB: body %q does not contain database_unavailable envelope", got)
	}
}

// spec 外のルートでもエラーが統一封筒で返ることを検証する。
func TestNotFoundEnvelope(t *testing.T) {
	e := server.New(nil)
	rec := do(e, http.MethodGet, "/api/nonexistent", "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET /api/nonexistent: got status %d, want %d", rec.Code, http.StatusNotFound)
	}
	if got := rec.Body.String(); !strings.Contains(got, `"code":"not_found"`) {
		t.Errorf("GET /api/nonexistent: body %q does not contain not_found envelope", got)
	}
}
