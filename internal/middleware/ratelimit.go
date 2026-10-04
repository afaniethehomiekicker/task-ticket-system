package middleware

import (
	"bytes"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

// failureLimiter counts FAILED attempts per key inside a fixed window and
// blocks the key once it reaches max. State is in memory, so it is per server
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

// tryReserve counts one attempt against key, unless the key is already at
// its limit, in which case it reports how long until the window ends. Check
// and count happen under one lock, so a burst of parallel requests can't all
// slip past the check before any of them is counted.
func (l *failureLimiter) tryReserve(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	e, ok := l.entries[key]
	if !ok || now.Sub(e.windowStart) >= l.window {
		e = &failureEntry{windowStart: now}
		l.entries[key] = e
	}
	if e.count >= l.max {
		return false, l.window - now.Sub(e.windowStart)
	}
	e.count++
	l.prune(now)
	return true, 0
}

// release gives back one reserved attempt (the attempt turned out not to be
// a failed password).
func (l *failureLimiter) release(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if e, ok := l.entries[key]; ok {
		e.count--
		if e.count <= 0 {
			delete(l.entries, key)
		}
	}
}

func (l *failureLimiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, key)
}

// prune keeps the map from growing without bound. Caller holds the lock.
func (l *failureLimiter) prune(now time.Time) {
	if len(l.entries) <= 10000 {
		return
	}
	for k, v := range l.entries {
		if now.Sub(v.windowStart) >= l.window {
			delete(l.entries, k)
		}
	}
}

// LoginLimits sets how many FAILED logins are allowed inside Window before
// further attempts are refused (429) until the window passes.
type LoginLimits struct {
	// PerAccountIP: one account from one address — the ordinary "someone
	// keeps typing the wrong password" case. Cleared by a successful login.
	PerAccountIP int
	// PerAccount: one account from ANY address — stops guessing a password
	// spread across many IPs. Not cleared by a success.
	PerAccount int
	// PerIP: any accounts from one address — stops one machine trying
	// password after password across many accounts. Not cleared by a
	// success. Keep it generous: an office shares one public IP.
	PerIP  int
	Window time.Duration
}

// LoginRateLimit slows down password guessing on the login endpoint.
//
// The old limiter counted failures per IP only and wiped the IP's count on
// ANY successful login. Anyone with a working account of their own could make
// nine guesses at someone else's password, sign in as themselves to reset the
// counter, and repeat forever. It also had no per-account limit, and parallel
// requests could all pass the check before any failure was counted.
//
// Now every attempt is counted up front against three keys (address+account,
// account, address). An attempt that turns out not to be a wrong password
// (success, bad input, failed captcha, disabled account) gives its slot back;
// a wrong password (401) keeps it. A success clears only the
// address+account key — never the counters an attacker would want reset.
//
// The address is c.ClientIP(), which is only trustworthy if the server is
// told which proxies to trust (TRUSTED_PROXIES, see main.go).
func LoginRateLimit(limits LoginLimits) gin.HandlerFunc {
	pair := newFailureLimiter(limits.PerAccountIP, limits.Window)
	account := newFailureLimiter(limits.PerAccount, limits.Window)
	address := newFailureLimiter(limits.PerIP, limits.Window)

	type slot struct {
		lim *failureLimiter
		key string
	}

	return func(c *gin.Context) {
		email, ok := loginEmail(c)
		if !ok {
			return // response already written
		}
		ip := c.ClientIP()

		slots := []slot{{address, ip}}
		if email != "" {
			slots = append(slots, slot{account, email}, slot{pair, ip + "|" + email})
		}

		taken := make([]slot, 0, len(slots))
		for _, s := range slots {
			allowed, wait := s.lim.tryReserve(s.key)
			if !allowed {
				for _, t := range taken {
					t.lim.release(t.key)
				}
				c.Header("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
				c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many failed login attempts. Try again later."})
				c.Abort()
				return
			}
			taken = append(taken, s)
		}

		c.Next()

		status := c.Writer.Status()
		if status == http.StatusUnauthorized {
			return // wrong email or password: the attempt stays counted
		}
		for _, t := range taken {
			t.lim.release(t.key)
		}
		if status == http.StatusOK && email != "" {
			pair.reset(ip + "|" + email)
		}
	}
}

// maxLoginBody bounds what the limiter reads; a login body is a few hundred
// bytes.
const maxLoginBody = 64 << 10

// loginEmail reads the email from the login body (and puts the body back for
// the handler). It decodes with gin's JSON binding — the same decoder the
// Login handler uses — so the account the limiter counts is always the one
// the handler checks: no key-casing or trailing-data trick makes them differ.
// Lower-cased so "Admin@x" and "admin@x" share one counter. Returns ok=false
// (after writing a 413) for an oversized body; an unreadable body gives ""
// and only the per-address limit applies — the handler rejects it anyway.
func loginEmail(c *gin.Context) (string, bool) {
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, maxLoginBody+1))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Could not read request"})
		c.Abort()
		return "", false
	}
	if len(raw) > maxLoginBody {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Request too large"})
		c.Abort()
		return "", false
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(raw))
	c.Request.ContentLength = int64(len(raw))

	var body struct {
		Email string `json:"email"`
	}
	if binding.JSON.BindBody(raw, &body) != nil {
		return "", true
	}
	return strings.ToLower(strings.TrimSpace(body.Email)), true
}
