// Package auth owns dependency-free authentication security primitives.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
)

const (
	SessionCookieName = "__Host-dsa_session"
	SessionLifetime   = 7 * 24 * 60 * 60
)

// NewToken returns 256 bits of cryptographically random, URL-safe entropy.
func NewToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

// HashToken returns the only representation of a session token persisted in PostgreSQL.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
