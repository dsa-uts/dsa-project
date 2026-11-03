package httpresponse

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
)

// Error carries an expected HTTP failure from an API handler or authentication.
type Error struct {
	Code    int
	Message string
}

func (e *Error) Error() string { return e.Message }

func ErrorHandler(w http.ResponseWriter, r *http.Request, err error) {
	if tracked, ok := w.(*responseWriter); ok && tracked.written {
		LogError(w, r, err)
		return
	}
	status := http.StatusInternalServerError
	message := http.StatusText(status)
	if httpErr, ok := errors.AsType[*Error](err); ok {
		status = httpErr.Code
		message = http.StatusText(status)
		if status < 500 && httpErr.Message != "" {
			message = httpErr.Message
		}
	}
	if status >= 500 {
		LogError(w, r, err)
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if r.Method == http.MethodHead {
		return
	}
	if err := json.NewEncoder(w).
		Encode(generated.Error{Code: status, Message: message}); err != nil {
		LogError(w, r, err)
	}
}

// LogError handles response write failures without appending another response.
func LogError(_ http.ResponseWriter, r *http.Request, err error) {
	slog.ErrorContext(
		r.Context(),
		"request failed",
		"method",
		r.Method,
		"path",
		r.URL.Path,
		"error",
		err,
	)
}

func BadRequest(w http.ResponseWriter, r *http.Request, err error) {
	ErrorHandler(w, r, &Error{Code: http.StatusBadRequest, Message: err.Error()})
}

// TrackResponse records whether the generated response writer has committed headers.
func TrackResponse(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(&responseWriter{ResponseWriter: w}, r)
	})
}

type responseWriter struct {
	http.ResponseWriter
	written bool
}

func (w *responseWriter) WriteHeader(status int) {
	if !w.written {
		w.written = true
		w.ResponseWriter.WriteHeader(status)
	}
}

func (w *responseWriter) Write(data []byte) (int, error) {
	w.WriteHeader(http.StatusOK)
	return w.ResponseWriter.Write(data)
}

func (w *responseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
