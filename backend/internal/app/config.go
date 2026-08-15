package app

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
)

type PostgreSQLConnectionSettings struct {
	Host     string
	Port     string
	User     string
	Database string
	Password string
}

type RedisConnectionSettings struct {
	Host     string
	Port     string
	Database string
	Password string
}

// LoadDatastoreConfig builds datastore connection URLs from non-secret process
// configuration and passwords mounted as files.
func LoadDatastoreConfig() (DatastoreConfig, error) {
	databaseHost, err := requiredEnvironment("DATABASE_HOST")
	if err != nil {
		return DatastoreConfig{}, err
	}
	databasePort, err := requiredEnvironment("DATABASE_PORT")
	if err != nil {
		return DatastoreConfig{}, err
	}
	databaseUser, err := requiredEnvironment("DATABASE_USER")
	if err != nil {
		return DatastoreConfig{}, err
	}
	databaseName, err := requiredEnvironment("DATABASE_NAME")
	if err != nil {
		return DatastoreConfig{}, err
	}
	databasePassword, err := readSecretEnvironment("DATABASE_PASSWORD_FILE")
	if err != nil {
		return DatastoreConfig{}, err
	}
	redisHost, err := requiredEnvironment("REDIS_HOST")
	if err != nil {
		return DatastoreConfig{}, err
	}
	redisPort, err := requiredEnvironment("REDIS_PORT")
	if err != nil {
		return DatastoreConfig{}, err
	}
	redisDatabase, err := requiredEnvironment("REDIS_DATABASE")
	if err != nil {
		return DatastoreConfig{}, err
	}
	redisPassword, err := readSecretEnvironment("REDIS_PASSWORD_FILE")
	if err != nil {
		return DatastoreConfig{}, err
	}

	return BuildDatastoreConfig(
		PostgreSQLConnectionSettings{
			Host:     databaseHost,
			Port:     databasePort,
			User:     databaseUser,
			Database: databaseName,
			Password: databasePassword,
		},
		RedisConnectionSettings{
			Host:     redisHost,
			Port:     redisPort,
			Database: redisDatabase,
			Password: redisPassword,
		},
	), nil
}

// BuildDatastoreConfig constructs driver connection URLs from validated
// connection settings without reading process or filesystem state.
func BuildDatastoreConfig(postgresql PostgreSQLConnectionSettings, redis RedisConnectionSettings) DatastoreConfig {
	databaseURL := (&url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(postgresql.User, postgresql.Password),
		Host:     net.JoinHostPort(postgresql.Host, postgresql.Port),
		Path:     "/" + postgresql.Database,
		RawQuery: "sslmode=disable",
	}).String()
	redisURL := (&url.URL{
		Scheme: "redis",
		User:   url.UserPassword("", redis.Password),
		Host:   net.JoinHostPort(redis.Host, redis.Port),
		Path:   "/" + redis.Database,
	}).String()

	return DatastoreConfig{DatabaseURL: databaseURL, RedisURL: redisURL}
}

func requiredEnvironment(name string) (string, error) {
	value := os.Getenv(name)
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}

func readSecretEnvironment(name string) (string, error) {
	path, err := requiredEnvironment(name)
	if err != nil {
		return "", err
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", name, err)
	}
	value := strings.TrimSuffix(strings.TrimSuffix(string(contents), "\n"), "\r")
	if value == "" {
		return "", fmt.Errorf("read %s: %w", name, errors.New("secret is empty"))
	}
	return value, nil
}
