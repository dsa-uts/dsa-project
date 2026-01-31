package middleware

import (
	"net/http"
	"sync"
	"time"

	"dsa-backend/handler/response"

	"github.com/labstack/echo/v4"
	"golang.org/x/time/rate"
)

// limiterEntry holds a rate limiter and its last access time
type limiterEntry struct {
	limiter    *rate.Limiter
	lastAccess time.Time
}

// LoginRateLimiter manages rate limiting per username
type LoginRateLimiter struct {
	limiters map[string]*limiterEntry
	mu       sync.RWMutex
	rate     rate.Limit
	burst    int
	ttl      time.Duration
	stopCh   chan struct{}
}

// NewLoginRateLimiter creates a new rate limiter with automatic cleanup
// r: requests per second (e.g., rate.Every(time.Minute/10) for 10 req/min)
// b: burst size
// ttl: time after which inactive entries are removed (e.g., 1 hour)
func NewLoginRateLimiter(r rate.Limit, b int, ttl time.Duration) *LoginRateLimiter {
	l := &LoginRateLimiter{
		limiters: make(map[string]*limiterEntry),
		rate:     r,
		burst:    b,
		ttl:      ttl,
		stopCh:   make(chan struct{}),
	}

	// Start cleanup goroutine
	go l.cleanup()

	return l
}

// cleanup periodically removes stale entries
func (l *LoginRateLimiter) cleanup() {
	ticker := time.NewTicker(l.ttl / 2) // Run cleanup at half the TTL interval
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			l.removeStaleEntries()
		case <-l.stopCh:
			return
		}
	}
}

// removeStaleEntries removes entries that haven't been accessed within the TTL
func (l *LoginRateLimiter) removeStaleEntries() {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()

	// collect keys to iterate over
	usernames := make([]string, 0, len(l.limiters))
	for username := range l.limiters {
		usernames = append(usernames, username)
	}

	// iterate over collected keys
	for _, username := range usernames {
		entry := l.limiters[username]
		if now.Sub(entry.lastAccess) > l.ttl {
			delete(l.limiters, username)
		}
	}
}

// Stop stops the cleanup goroutine
func (l *LoginRateLimiter) Stop() {
	close(l.stopCh)
}

// getLimiter returns the rate limiter for the given username
func (l *LoginRateLimiter) getLimiter(username string) *rate.Limiter {
	l.mu.RLock()
	entry, exists := l.limiters[username]
	l.mu.RUnlock()

	if exists {
		l.mu.Lock()
		entry.lastAccess = time.Now()
		l.mu.Unlock()
		return entry.limiter
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	// Double check after acquiring write lock
	if entry, exists = l.limiters[username]; exists {
		entry.lastAccess = time.Now()
		return entry.limiter
	}

	limiter := rate.NewLimiter(l.rate, l.burst)
	l.limiters[username] = &limiterEntry{
		limiter:    limiter,
		lastAccess: time.Now(),
	}
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

			// If username is too long, abort early to prevent abuse
			if len(username) > 30 {
				return c.JSON(http.StatusBadRequest, response.NewError("malformed credentials"))
			}

			limiter := l.getLimiter(username)
			if !limiter.Allow() {
				return c.JSON(http.StatusTooManyRequests, response.NewError("too many login attempts, please try again later"))
			}

			return next(c)
		}
	}
}
