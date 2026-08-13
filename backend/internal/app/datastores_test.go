package app_test

import (
	"context"
	"strings"
	"testing"

	"github.com/dsa-uts/dsa-project/backend/internal/app"
)

func TestConnectDatastoresRequiresBothURLs(t *testing.T) {
	for name, cfg := range map[string]app.DatastoreConfig{
		"PostgreSQL": {RedisURL: "redis://localhost:6379/0"},
		"Redis":      {DatabaseURL: "postgres://localhost/dsa"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := app.ConnectDatastores(context.Background(), cfg)
			if err == nil || !strings.Contains(err.Error(), name) {
				t.Fatalf("ConnectDatastores() error = %v, want missing %s configuration", err, name)
			}
		})
	}
}
