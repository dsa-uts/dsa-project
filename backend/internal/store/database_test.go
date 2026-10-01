package store_test

import (
	"strings"
	"testing"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

func TestConnectDatabaseRequiresPostgreSQLURL(t *testing.T) {
	_, err := store.ConnectDatabase(t.Context(), "")
	if err == nil || !strings.Contains(err.Error(), "PostgreSQL") {
		t.Fatalf("ConnectDatabase() error = %v, want missing PostgreSQL configuration", err)
	}
}
