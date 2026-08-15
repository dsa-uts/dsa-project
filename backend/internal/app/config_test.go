package app_test

import (
	"net/url"
	"testing"

	"github.com/dsa-uts/dsa-project/backend/internal/app"
)

func TestBuildDatastoreConfigEscapesConnectionSettings(t *testing.T) {
	cfg := app.BuildDatastoreConfig(
		app.PostgreSQLConnectionSettings{
			Host:     "dsa-postgresql",
			Port:     "5432",
			User:     "dsa user",
			Database: "dsa/database",
			Password: "postgres p@ssword",
		},
		app.RedisConnectionSettings{
			Host:     "dsa-redis",
			Port:     "6379",
			Database: "2",
			Password: "redis p@ssword",
		},
	)

	postgresURL, err := url.Parse(cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("parse DatabaseURL: %v", err)
	}
	if got, want := postgresURL.Host, "dsa-postgresql:5432"; got != want {
		t.Errorf("DatabaseURL host = %q, want %q", got, want)
	}
	if got, want := postgresURL.User.Username(), "dsa user"; got != want {
		t.Errorf("DatabaseURL user = %q, want %q", got, want)
	}
	if password, ok := postgresURL.User.Password(); !ok || password != "postgres p@ssword" {
		t.Errorf("DatabaseURL password = %q, %v; want configured password", password, ok)
	}
	if got, want := postgresURL.Path, "/dsa/database"; got != want {
		t.Errorf("DatabaseURL path = %q, want %q", got, want)
	}
	if got, want := postgresURL.Query().Get("sslmode"), "disable"; got != want {
		t.Errorf("DatabaseURL sslmode = %q, want %q", got, want)
	}

	redisURL, err := url.Parse(cfg.RedisURL)
	if err != nil {
		t.Fatalf("parse RedisURL: %v", err)
	}
	if got, want := redisURL.Host, "dsa-redis:6379"; got != want {
		t.Errorf("RedisURL host = %q, want %q", got, want)
	}
	if password, ok := redisURL.User.Password(); !ok || password != "redis p@ssword" {
		t.Errorf("RedisURL password = %q, %v; want configured password", password, ok)
	}
	if got, want := redisURL.Path, "/2"; got != want {
		t.Errorf("RedisURL path = %q, want %q", got, want)
	}
}
