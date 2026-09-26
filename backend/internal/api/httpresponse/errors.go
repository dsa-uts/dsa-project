package httpresponse

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/labstack/echo/v4"
)

func ErrorHandler(err error, c echo.Context) {
	status := http.StatusInternalServerError
	message := http.StatusText(status)

	if httpErr, ok := errors.AsType[*echo.HTTPError](err); ok {
		status = httpErr.Code
		message = http.StatusText(status)

		// Don't expose information about internal server error
		if status < 500 {
			if text, ok := httpErr.Message.(string); ok {
				message = text
			}
		}
	}

	if status >= 500 {
		slog.ErrorContext(c.Request().Context(), "request failed",
			"method", c.Request().Method,
			"path", c.Request().URL.Path,
			"status", status,
			"error", err,
		)
	}

	// Don't overwrite if response is already commited
	if c.Response().Committed {
		return
	}

	c.Response().Header().Set("Cache-Control", "no-store")

	var writerErr error
	if c.Request().Method == http.MethodHead {
		writerErr = c.NoContent(status)
	} else {
		writerErr = c.JSON(status, generated.Error{
			Code:    status,
			Message: message,
		})
	}
	if writerErr != nil {
		slog.ErrorContext(c.Request().Context(),
			"writer error response", "error", writerErr)
	}
}
