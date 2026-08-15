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
	Port        string
	DatabaseURL string
	RedisURL    string
}

type specification struct {
	Port                 string     `envconfig:"PORT" default:"8080"`
	DatabaseHost         string     `envconfig:"DATABASE_HOST" required:"true"`
	DatabasePort         string     `envconfig:"DATABASE_PORT" required:"true"`
	DatabaseUser         string     `envconfig:"DATABASE_USER" required:"true"`
	DatabaseName         string     `envconfig:"DATABASE_NAME" required:"true"`
	DatabasePasswordFile secretFile `envconfig:"DATABASE_PASSWORD_FILE" required:"true"`
	RedisHost            string     `envconfig:"REDIS_HOST" required:"true"`
	RedisPort            string     `envconfig:"REDIS_PORT" required:"true"`
	RedisDatabase        string     `envconfig:"REDIS_DATABASE" required:"true"`
	RedisPasswordFile    secretFile `envconfig:"REDIS_PASSWORD_FILE" required:"true"`
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

var (
	configuration Configuration
	loadErr       error
)

func init() {
	configuration, loadErr = load()
}

// Get returns the configuration loaded during package initialization.
func Get() (Configuration, error) {
	return configuration, loadErr
}

func load() (Configuration, error) {
	var spec specification
	if err := envconfig.Process("", &spec); err != nil {
		return Configuration{}, fmt.Errorf("process environment: %w", err)
	}

	databaseURL := (&url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(spec.DatabaseUser, string(spec.DatabasePasswordFile)),
		Host:     net.JoinHostPort(spec.DatabaseHost, spec.DatabasePort),
		Path:     "/" + spec.DatabaseName,
		RawQuery: "sslmode=disable",
	}).String()
	redisURL := (&url.URL{
		Scheme: "redis",
		User:   url.UserPassword("", string(spec.RedisPasswordFile)),
		Host:   net.JoinHostPort(spec.RedisHost, spec.RedisPort),
		Path:   "/" + spec.RedisDatabase,
	}).String()

	return Configuration{
		Port:        spec.Port,
		DatabaseURL: databaseURL,
		RedisURL:    redisURL,
	}, nil
}
