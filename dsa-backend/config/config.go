package config

import (
	"fmt"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	CORSAllowedOrigins []string
}

var Cfg *Config

func Load() error {
	// Load environment information (default: development)
	env := os.Getenv("APP_ENV")
	if env == "" {
		env = "development"
	}

	envFile := fmt.Sprintf(".env.%s", env)

	// Load environment variables from .env file
	if _, err := os.Stat(envFile); err == nil {
		if err := godotenv.Load(envFile); err != nil {
			return fmt.Errorf("failed to load %s: %w", envFile, err)
		}
	}

	// Load default .env file
	// godotenv.Load(".env")

	Cfg = &Config{
		CORSAllowedOrigins: parseCORSOrigins(),
	}

	return nil
}

func parseCORSOrigins() []string {
	originStr := os.Getenv("CORS_ALLOWED_ORIGINS")
	if originStr == "" {
		return []string{"http://localhost:5173"}
	}

	// split by comma
	origins := strings.Split(originStr, ",")

	// trim spaces
	for i, origin := range origins {
		origins[i] = strings.TrimSpace(origin)
	}

	return origins
}
