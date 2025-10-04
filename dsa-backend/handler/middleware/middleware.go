package middleware

import (
	"context"
	"dsa-backend/handler/auth"
	"net/http"
	"time"

	"github.com/dsa-uts/dsa-project/database"
	"github.com/golang-jwt/jwt/v5"
	echojwt "github.com/labstack/echo-jwt/v4"
	"github.com/labstack/echo/v4"
	"github.com/uptrace/bun"
)

func JWTMiddleware(secret string) echo.MiddlewareFunc {
	return echojwt.WithConfig(echojwt.Config{
		NewClaimsFunc: func(c echo.Context) jwt.Claims {
			return new(auth.JwtCustomClaims)
		},
		SigningKey: []byte(secret),
		ContextKey: "user",
	})
}

func RequiredScopesMiddleware(requiredScopes ...auth.Scope) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			claims, err := auth.GetJWTClaims(&c)
			if err != nil {
				return echo.NewHTTPError(http.StatusUnauthorized, "invalid token claims")
			}

			if !claims.HasAllScopes(requiredScopes...) {
				return echo.NewHTTPError(http.StatusForbidden, "insufficient rights")
			}

			return next(c)
		}
	}
}

func CheckValidityOfJWTMiddleware(db *bun.DB) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			claims, err := auth.GetJWTClaims(&c)

			if err != nil {
				return err
			}

			// Check token expiration
			if claims.ExpiresAt.Time.Before(time.Now()) {
				return echo.NewHTTPError(http.StatusUnauthorized, "token expired")
			}

			ctx := context.Background()
			userStore := database.NewUserStore(db)

			// Check login history existence
			loginHistory, err := userStore.GetLoginHistory(ctx, claims.UserID, claims.IssuedAt.Time)

			if err != nil {
				return echo.NewHTTPError(http.StatusInternalServerError, "failed to get login history")
			}

			if loginHistory == nil {
				return echo.NewHTTPError(http.StatusUnauthorized, "login history not found")
			}

			if loginHistory.LogoutAt.Before(time.Now()) {
				return echo.NewHTTPError(http.StatusUnauthorized, "your token has expired.")
			}

			return next(c)
		}
	}
}
