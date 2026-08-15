package config

import (
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestLoad(t *testing.T) {
	secretDirectory := t.TempDir()
	databasePasswordPath := filepath.Join(secretDirectory, "postgres-password")
	redisPasswordPath := filepath.Join(secretDirectory, "redis-password")
	if err := os.WriteFile(databasePasswordPath, []byte("postgres p@ssword\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(redisPasswordPath, []byte("redis p@ssword\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	for name, value := range map[string]string{
		"DATABASE_HOST":          "dsa-postgresql",
		"DATABASE_PORT":          "5432",
		"DATABASE_USER":          "dsa user",
		"DATABASE_NAME":          "dsa/database",
		"DATABASE_PASSWORD_FILE": databasePasswordPath,
		"REDIS_HOST":             "dsa-redis",
		"REDIS_PORT":             "6379",
		"REDIS_DATABASE":         "2",
		"REDIS_PASSWORD_FILE":    redisPasswordPath,
	} {
		t.Setenv(name, value)
	}

	cfg, err := load()
	if err != nil {
		t.Fatalf("load configuration: %v", err)
	}
	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want %q", cfg.Port, "8080")
	}

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
