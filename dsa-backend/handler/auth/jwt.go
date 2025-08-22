package auth

import (
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
)

// JwtCustomClaims are custom claims extending default ones.
// See https://github.com/golang-jwt/jwt for more examples
type JwtCustomClaims struct {
	UserID string   `json:"userid"`
	Scopes []string `json:"scopes"`
	jwt.RegisteredClaims
}

func IssueNewToken(userid string, scopes []string, secret string, issuedAt time.Time, expiredAt time.Time) (string, error) {
	newClaim := newJwtCustomClaims(userid, scopes, issuedAt, expiredAt)
	newToken := createToken(newClaim)
	newTokenStr, err := newToken.SignedString([]byte(secret))
	if err != nil {
		return "", err
	}
	return newTokenStr, nil
}

func createToken(claim *JwtCustomClaims) *jwt.Token {
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claim)
}

func newJwtCustomClaims(userid string, scopes []string, issuedAt time.Time, expiredAt time.Time) *JwtCustomClaims {
	return &JwtCustomClaims{
		UserID: userid,
		Scopes: scopes,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(issuedAt),
			ExpiresAt: jwt.NewNumericDate(expiredAt),
		},
	}
}

func GetJWTClaims(c *echo.Context) (*JwtCustomClaims, error) {
	token, ok := (*c).Get("user").(*jwt.Token)
	if !ok {
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "invalid token")
	}

	claims, ok := token.Claims.(*JwtCustomClaims)
	if !ok {
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "invalid token claims")
	}

	return claims, nil
}
