// Package config loads process configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"

	"github.com/kelseyhightower/envconfig"
)

// Configuration is the process configuration loaded when this package is
// initialized. Use Get to obtain the initialized value and any loading error.
type Configuration struct {
	Port                  string
	DatabaseURL           string
	S3Endpoint            string
	S3Bucket              string
	ResourceRepositoryURL string
	ResourceGitHubToken   string
	DevelopmentSeed       bool
}

type ServerConfig struct {
	Port                  string
	DatabaseURL           string
	ResourceRepositoryURL string
	ResourceGitHubToken   string
	DevelopmentSeed       bool
}

type JudgeConfig struct {
	DatabaseURL string
}

func LoadServer() (ServerConfig, error) {
	var spec struct {
		Port                    string     `envconfig:"PORT" default:"8080"`
		ResourceRepositoryURL   string     `envconfig:"RESOURCE_REPOSITORY_URL" required:"true"`
		ResourceGitHubTokenFile secretFile `envconfig:"RESOURCE_GITHUB_TOKEN_FILE"`
		DevelopmentSeed         bool       `envconfig:"DEVELOPMENT_SEED" default:"false"`
	}

	if err := envconfig.Process("", &spec); err != nil {
		return ServerConfig{}, fmt.Errorf("server environment: %w", err)
	}

	databaseURL, err := loadDatabaseURL()
	if err != nil {
		return ServerConfig{}, err
	}

	return ServerConfig{
		Port:                  spec.Port,
		DatabaseURL:           databaseURL,
		ResourceRepositoryURL: spec.ResourceRepositoryURL,
		ResourceGitHubToken:   string(spec.ResourceGitHubTokenFile),
		DevelopmentSeed:       spec.DevelopmentSeed,
	}, nil
}

func LoadJudge() (JudgeConfig, error) {
	databaseURL, err := loadDatabaseURL()
	if err != nil {
		return JudgeConfig{}, err
	}

	return JudgeConfig{
		DatabaseURL: databaseURL,
	}, nil
}

func loadDatabaseURL() (string, error) {
	var spec struct {
		Host         string     `envconfig:"DATABASE_HOST" required:"true"`
		Port         string     `envconfig:"DATABASE_PORT" required:"true"`
		User         string     `envconfig:"DATABASE_USER" required:"true"`
		Name         string     `envconfig:"DATABASE_NAME" required:"true"`
		PasswordFile secretFile `envconfig:"DATABASE_PASSWORD_FILE" required:"true"`
	}

	if err := envconfig.Process("", &spec); err != nil {
		return "", fmt.Errorf("database environment: %w", err)
	}

	return (&url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(spec.User, string(spec.PasswordFile)),
		Host:     net.JoinHostPort(spec.Host, spec.Port),
		Path:     "/" + spec.Name,
		RawQuery: "sslmode=disable",
	}).String(), nil
}

type secretFile string

// Decode implements envconfig.Decoder. Environment values represent paths to
// mounted secret files; the decoded value is the file contents.
func (secret *secretFile) Decode(path string) error {
	contents, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	value := strings.TrimSuffix(strings.TrimSuffix(string(contents), "\n"), "\r")
	if value == "" {
		return errors.New("secret is empty")
	}
	*secret = secretFile(value)
	return nil
}
