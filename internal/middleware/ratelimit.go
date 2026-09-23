package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// failureLimiter counts FAILED attempts per key (here: client IP) inside a
// fixed window and blocks the key once it reaches max. Successful attempts
// don't count and clear the key. State is in memory, so it is per server
// process (fine for one instance; use a shared store if you run several).
type failureLimiter struct {
	mu      sync.Mutex
	max     int
	window  time.Duration
	entries map[string]*failureEntry
	now     func() time.Time
}

type failureEntry struct {
	count       int
	windowStart time.Time
}

func newFailureLimiter(max int, window time.Duration) *failureLimiter {
	return &failureLimiter{max: max, window: window, entries: map[string]*failureEntry{}, now: time.Now}
}

// blocked reports whether key is currently locked out, and for how long.
func (l *failureLimiter) blocked(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[key]
	if !ok {
		return false, 0
	}
	elapsed := l.now().Sub(e.windowStart)
	if elapsed >= l.window {
		delete(l.entries, key)
		return false, 0
	}
	if e.count >= l.max {
		return true, l.window - elapsed
	}
	return false, 0
}

func (l *failureLimiter) recordFailure(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	e, ok := l.entries[key]
	if !ok || now.Sub(e.windowStart) >= l.window {
		e = &failureEntry{windowStart: now}
		l.entries[key] = e
	}
	e.count++

	// Keep the map from growing without bound.
	if len(l.entries) > 10000 {
		for k, v := range l.entries {
			if now.Sub(v.windowStart) >= l.window {
				delete(l.entries, k)
			}
		}
	}
}

func (l *failureLimiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, key)
}

// LoginRateLimit slows down password guessing on the login endpoints: after
// maxFailures rejected logins (401) from one client IP inside window, further
// attempts get 429 until the window passes. Login had no limit at all, which
// matters with an account like the seeded super admin. Use one instance for
// all login routes so they share the count.
//
// The key is c.ClientIP(), which is only trustworthy if the server is told
// which proxies to trust (see main.go) — otherwise a caller can rotate
// X-Forwarded-For and dodge the limit.
func LoginRateLimit(maxFailures int, window time.Duration) gin.HandlerFunc {
	limiter := newFailureLimiter(maxFailures, window)
	return func(c *gin.Context) {
		key := c.ClientIP()
		if blocked, wait := limiter.blocked(key); blocked {
			c.Header("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many failed login attempts. Try again later."})
			c.Abort()
			return
		}

		c.Next()

		switch c.Writer.Status() {
		case http.StatusUnauthorized:
			limiter.recordFailure(key)
		case http.StatusOK:
			limiter.reset(key)
		}
	}
}
