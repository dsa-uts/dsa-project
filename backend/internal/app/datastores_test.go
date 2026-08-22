package app_test

import (
	"context"
	"strings"
	"testing"

	"github.com/dsa-uts/dsa-project/backend/internal/app"
)

func TestConnectDatabaseRequiresPostgreSQLURL(t *testing.T) {
	_, err := app.ConnectDatabase(context.Background(), "")
	if err == nil || !strings.Contains(err.Error(), "PostgreSQL") {
		t.Fatalf("ConnectDatabase() error = %v, want missing PostgreSQL configuration", err)
	}
}
