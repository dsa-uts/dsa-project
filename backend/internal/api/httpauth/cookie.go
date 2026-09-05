// Package httpauth handles HTTP session cookies and authorized actors.
// Password hashing and token primitives live in internal/auth.
package httpauth

import (
	"fmt"

	"github.com/dsa-uts/dsa-project/backend/internal/auth"
)

func SessionCookie(token string) string {
	return fmt.Sprintf("%s=%s; Path=/; Max-Age=%d; HttpOnly; Secure; SameSite=Lax", auth.SessionCookieName, token, auth.SessionLifetime)
}

func ClearedSessionCookie() string {
	return fmt.Sprintf("%s=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax", auth.SessionCookieName)
}
