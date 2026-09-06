package app_test

import (
	"strings"
	"testing"

	"github.com/dsa-uts/dsa-project/backend/internal/app"
)

func TestConnectDatabaseRequiresPostgreSQLURL(t *testing.T) {
	_, err := app.ConnectDatabase(t.Context(), "", false)
	if err == nil || !strings.Contains(err.Error(), "PostgreSQL") {
		t.Fatalf("ConnectDatabase() error = %v, want missing PostgreSQL configuration", err)
	}
}
