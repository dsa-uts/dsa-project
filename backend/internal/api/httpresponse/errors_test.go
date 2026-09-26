package httpresponse

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestErrorHandler(t *testing.T) {
	for _, tc := range []struct {
		name    string
		err     error
		status  int
		message string
	}{
		{"client error", echo.NewHTTPError(409, "Already taken."), 409, "Already taken."},
		{"wrapped error", fmt.Errorf("request: %w", echo.NewHTTPError(404, "Missing.")), 404, "Missing."},
		{"non-string message", echo.NewHTTPError(400, map[string]string{"private": "secret"}), 400, "Bad Request"},
		{"internal error", errors.New("database secret"), 500, "Internal Server Error"},
		{"HTTP server error", echo.NewHTTPError(503, "upstream secret"), 503, "Service Unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				t.Run(method, func(t *testing.T) {
					rec := httptest.NewRecorder()
					c := echo.New().NewContext(httptest.NewRequest(method, "/api/example", nil), rec)
					ErrorHandler(tc.err, c)
					if rec.Code != tc.status || rec.Header().Get("Cache-Control") != "no-store" {
						t.Fatalf("status=%d headers=%v", rec.Code, rec.Header())
					}
					if method == http.MethodHead {
						if rec.Body.Len() != 0 {
							t.Fatalf("HEAD body: %s", rec.Body)
						}
						return
					}
					var body map[string]any
					if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
						t.Fatal(err)
					}
					if len(body) != 2 || body["code"] != float64(tc.status) || body["message"] != tc.message {
						t.Fatalf("unexpected error body: %s", rec.Body)
					}
				})
			}
		})
	}
}

func TestErrorHandlerPreservesCommittedResponse(t *testing.T) {
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(httptest.NewRequest(http.MethodGet, "/api/example", nil), rec)
	if err := c.String(http.StatusAccepted, "already written"); err != nil {
		t.Fatal(err)
	}
	ErrorHandler(errors.New("late error"), c)
	if rec.Code != http.StatusAccepted || rec.Body.String() != "already written" {
		t.Fatalf("overwrote committed response: %d %s", rec.Code, rec.Body)
	}
}
