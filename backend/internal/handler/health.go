package handler

import (
	"net/http"

	echo "github.com/labstack/echo/v4"
)

// Health is the liveness/readiness endpoint for Kubernetes probes.
func Health(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
}
