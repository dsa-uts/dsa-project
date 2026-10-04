package config

import (
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadServer(t *testing.T) {
	setDatabaseEnvironment(t)
	t.Setenv("RESOURCE_REPOSITORY_URL", "https://github.com/dsa-uts/dsa-resource-spec")
	for _, name := range []string{"PORT", "RESOURCE_GITHUB_TOKEN_FILE", "DEVELOPMENT_SEED"} {
		t.Setenv(name, "")
		if err := os.Unsetenv(name); err != nil {
			t.Fatal(err)
		}
	}

	cfg, err := LoadServer()
	if err != nil {
		t.Fatalf("load configuration: %v", err)
	}
	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want %q", cfg.Port, "8080")
	}
	if cfg.ResourceRepositoryURL != "https://github.com/dsa-uts/dsa-resource-spec" {
		t.Errorf("ResourceRepositoryURL = %q, want configured repository", cfg.ResourceRepositoryURL)
	}
	if cfg.DevelopmentSeed {
		t.Error("DevelopmentSeed = true, want false by default")
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
}

func TestLoadJudge(t *testing.T) {
	setDatabaseEnvironment(t)
	t.Setenv("RESOURCE_REPOSITORY_URL", "")
	if err := os.Unsetenv("RESOURCE_REPOSITORY_URL"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RESOURCE_GITHUB_TOKEN_FILE", filepath.Join(t.TempDir(), "missing-token"))
	t.Setenv("DEVELOPMENT_SEED", "invalid-bool")

	cfg, err := LoadJudge()
	if err != nil {
		t.Fatalf("load judge without valid server environment: %v", err)
	}
	if cfg.DatabaseURL == "" {
		t.Error("DatabaseURL is empty")
	}
}

func setDatabaseEnvironment(t *testing.T) {
	t.Helper()
	passwordPath := filepath.Join(t.TempDir(), "postgres-password")
	if err := os.WriteFile(passwordPath, []byte("postgres p@ssword\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]string{
		"DATABASE_HOST":          "dsa-postgresql",
		"DATABASE_PORT":          "5432",
		"DATABASE_USER":          "dsa user",
		"DATABASE_NAME":          "dsa/database",
		"DATABASE_PASSWORD_FILE": passwordPath,
	} {
		t.Setenv(name, value)
	}
}
