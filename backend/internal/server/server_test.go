package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	echo "github.com/labstack/echo/v4"
)

func TestHealth(t *testing.T) {
	e := New()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /health: got status %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Body.String(); !strings.Contains(got, `"status":"ok"`) {
		t.Errorf("GET /health: body %q does not contain status ok", got)
	}
}

func TestHelloGet(t *testing.T) {
	e := New()
	req := httptest.NewRequest(http.MethodGet, "/api/hello", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/hello: got status %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Body.String(); !strings.Contains(got, `"message":"hello"`) {
		t.Errorf("GET /api/hello: body %q does not contain hello message", got)
	}
}

func TestHelloPost(t *testing.T) {
	e := New()
	req := httptest.NewRequest(http.MethodPost, "/api/hello", strings.NewReader(`{"name":"dsa"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/hello: got status %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	if got := rec.Body.String(); !strings.Contains(got, `"message":"hello, dsa"`) {
		t.Errorf("POST /api/hello: body %q does not contain greeting", got)
	}
}

func TestHelloPostMissingName(t *testing.T) {
	e := New()
	req := httptest.NewRequest(http.MethodPost, "/api/hello", strings.NewReader(`{}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	// docs/spec/api.md: バリデーション失敗は 422、エラーは {"error":{"code","message"}} 封筒
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("POST /api/hello without name: got status %d, want %d", rec.Code, http.StatusUnprocessableEntity)
	}
	if got := rec.Body.String(); !strings.Contains(got, `"code":"validation_failed"`) {
		t.Errorf("POST /api/hello without name: body %q does not contain error envelope", got)
	}
}
