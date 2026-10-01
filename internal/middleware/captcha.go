package middleware

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// Captcha on the login endpoints.
//
// Configured from the environment (read on first use, after .env is loaded):
//
//	CAPTCHA_PROVIDER   turnstile (default) | hcaptcha | recaptcha (v2 checkbox)
//	CAPTCHA_SITE_KEY   public key, handed to the browser
//	CAPTCHA_SECRET_KEY private key, used only here to verify tokens
//
// Both keys empty = captcha OFF (handy for local development). One set and
// not the other is a configuration mistake and stops the server.
//
// The browser sends the widget's token in the X-Captcha-Token header, so the
// login handlers and their JSON bodies stay exactly as they were.

var captchaVerifyURLs = map[string]string{
	"turnstile": "https://challenges.cloudflare.com/turnstile/v0/siteverify",
	"hcaptcha":  "https://api.hcaptcha.com/siteverify",
	"recaptcha": "https://www.google.com/recaptcha/api/siteverify",
}

type captchaSettings struct {
	provider string
	siteKey  string
	secret   string
}

func (s captchaSettings) enabled() bool { return s.secret != "" }

var (
	captchaOnce   sync.Once
	captchaCfg    captchaSettings
	captchaClient = &http.Client{Timeout: 10 * time.Second}
)

func loadCaptchaSettings() captchaSettings {
	captchaOnce.Do(func() {
		provider := strings.ToLower(strings.TrimSpace(os.Getenv("CAPTCHA_PROVIDER")))
		if provider == "" {
			provider = "turnstile"
		}
		siteKey := strings.TrimSpace(os.Getenv("CAPTCHA_SITE_KEY"))
		secret := strings.TrimSpace(os.Getenv("CAPTCHA_SECRET_KEY"))

		if _, ok := captchaVerifyURLs[provider]; !ok {
			log.Fatalf("CAPTCHA_PROVIDER %q is not supported (use turnstile, hcaptcha or recaptcha)", provider)
		}
		if (siteKey == "") != (secret == "") {
			log.Fatal("CAPTCHA_SITE_KEY and CAPTCHA_SECRET_KEY must both be set (or both left empty to turn captcha off)")
		}
		if secret == "" {
			log.Println("WARNING: captcha is OFF for login (CAPTCHA_SITE_KEY / CAPTCHA_SECRET_KEY not set)")
		} else {
			log.Printf("Captcha enabled for login (%s)", provider)
		}
		captchaCfg = captchaSettings{provider: provider, siteKey: siteKey, secret: secret}
	})
	return captchaCfg
}

// CaptchaConfigHandler — GET /api/auth/captcha-config (public).
// Tells the login page whether to show a widget and which one. The site key
// is public by design; the secret never leaves the server.
func CaptchaConfigHandler(c *gin.Context) {
	s := loadCaptchaSettings()
	if !s.enabled() {
		c.JSON(http.StatusOK, gin.H{"enabled": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{"enabled": true, "provider": s.provider, "site_key": s.siteKey})
}

// RequireCaptcha rejects the request unless X-Captcha-Token holds a token the
// provider confirms. Does nothing when captcha is off. Put it AFTER the login
// rate limiter so an IP that is already locked out never costs a verify call.
func RequireCaptcha() gin.HandlerFunc {
	s := loadCaptchaSettings()
	return func(c *gin.Context) {
		if !s.enabled() {
			c.Next()
			return
		}

		token := strings.TrimSpace(c.GetHeader("X-Captcha-Token"))
		if token == "" || len(token) > 4096 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Please complete the security check."})
			c.Abort()
			return
		}

		ok, err := verifyCaptchaToken(c, s, token)
		if err != nil {
			// Fail closed: if the provider can't be reached, nobody logs in
			// rather than everybody skipping the check.
			log.Printf("captcha: verification unavailable: %v", err)
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "The security check is unavailable right now. Please try again in a moment."})
			c.Abort()
			return
		}
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Security check failed. Please try again."})
			c.Abort()
			return
		}
		c.Next()
	}
}

func verifyCaptchaToken(c *gin.Context, s captchaSettings, token string) (bool, error) {
	form := url.Values{"secret": {s.secret}, "response": {token}}

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost,
		captchaVerifyURLs[s.provider], strings.NewReader(form.Encode()))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := captchaClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("verify endpoint returned HTTP %d", resp.StatusCode)
	}

	var out struct {
		Success    bool     `json:"success"`
		ErrorCodes []string `json:"error-codes"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&out); err != nil {
		return false, fmt.Errorf("unreadable verify response: %w", err)
	}

	if !out.Success {
		for _, code := range out.ErrorCodes {
			// A bad secret is a server misconfiguration, not a bad user —
			// say so loudly in the log instead of silently rejecting everyone.
			if code == "invalid-input-secret" || code == "missing-input-secret" {
				log.Printf("captcha: the provider rejected CAPTCHA_SECRET_KEY (%s) — check the key and CAPTCHA_PROVIDER", code)
				return false, fmt.Errorf("secret key rejected")
			}
		}
		if len(out.ErrorCodes) > 0 {
			log.Printf("captcha: token rejected: %v", out.ErrorCodes)
		}
	}
	return out.Success, nil
}
