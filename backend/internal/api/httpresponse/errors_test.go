package httpresponse

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestErrorHandler(t *testing.T) {
	for _, tc := range []struct {
		name    string
		err     error
		status  int
		message string
	}{
		{"client error", &Error{Code: 409, Message: "Already taken."}, 409, "Already taken."},
		{"wrapped error", fmt.Errorf("request: %w", &Error{Code: 404, Message: "Missing."}), 404, "Missing."},
		{"internal error", errors.New("database secret"), 500, "Internal Server Error"},
		{"HTTP server error", &Error{Code: 503, Message: "upstream secret"}, 503, "Service Unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				t.Run(method, func(t *testing.T) {
					rec := httptest.NewRecorder()
					req := httptest.NewRequest(method, "/api/example", nil)
					ErrorHandler(rec, req, tc.err)
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
					if len(body) != 2 || body["code"] != float64(tc.status) ||
						body["message"] != tc.message {
						t.Fatalf("unexpected error body: %s", rec.Body)
					}
				})
			}
		})
	}
}

func TestResponseErrors(t *testing.T) {
	for _, committed := range []bool{false, true} {
		t.Run(fmt.Sprint(committed), func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/example", nil)
			handler := TrackResponse(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if committed {
					w.WriteHeader(http.StatusAccepted)
					_, _ = w.Write([]byte("already written"))
				}
				ErrorHandler(w, r, errors.New("encoding or write failure"))
			}))
			handler.ServeHTTP(rec, req)
			if committed {
				if rec.Code != http.StatusAccepted || rec.Body.String() != "already written" {
					t.Fatalf("overwrote committed response: %d %s", rec.Code, rec.Body)
				}
			} else {
				if rec.Code != http.StatusInternalServerError ||
					rec.Body.String() != "{\"code\":500,\"message\":\"Internal Server Error\"}\n" {
					t.Fatalf("unexpected error response: %d %s", rec.Code, rec.Body)
				}
			}
		})
	}
}
