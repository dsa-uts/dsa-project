package middleware

import (
	"net/http"
	"sync"

	"dsa-backend/handler/response"

	"github.com/labstack/echo/v4"
	"golang.org/x/time/rate"
)

// LoginRateLimiter manages rate limiting per username
type LoginRateLimiter struct {
	limiters map[string]*rate.Limiter
	mu       sync.RWMutex
	rate     rate.Limit
	burst    int
}

// NewLoginRateLimiter creates a new rate limiter
// r: requests per second (e.g., rate.Every(time.Minute/10) for 10 req/min)
// b: burst size
func NewLoginRateLimiter(r rate.Limit, b int) *LoginRateLimiter {
	return &LoginRateLimiter{
		limiters: make(map[string]*rate.Limiter),
		rate:     r,
		burst:    b,
	}
}

// getLimiter returns the rate limiter for the given username
func (l *LoginRateLimiter) getLimiter(username string) *rate.Limiter {
	l.mu.RLock()
	limiter, exists := l.limiters[username]
	l.mu.RUnlock()

	if exists {
		return limiter
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	// Double check after acquiring write lock
	if limiter, exists = l.limiters[username]; exists {
		return limiter
	}

	limiter = rate.NewLimiter(l.rate, l.burst)
	l.limiters[username] = limiter
	return limiter
}

// Middleware returns an Echo middleware function for rate limiting login attempts
func (l *LoginRateLimiter) Middleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// Get username from form data
			username := c.FormValue("username")
			if username == "" {
				// If no username, let the handler deal with validation
				return next(c)
			}

			limiter := l.getLimiter(username)
			if !limiter.Allow() {
				return c.JSON(http.StatusTooManyRequests, response.NewError("too many login attempts, please try again later"))
			}

			return next(c)
		}
	}
}
