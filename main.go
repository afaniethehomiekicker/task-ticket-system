package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"io/fs"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/handlers"
	"task-ticket-backend/internal/middleware"
	"task-ticket-backend/internal/routes"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

// Build info (set via ldflags at build time)
var (
	buildVersion = "dev"
	buildTime    = "unknown"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, relying on system environment")
	}

	// Resolve the JWT signing key now that .env has been loaded (it used to be
	// resolved during package init, before this point, so a JWT_SECRET set in
	// .env was ignored) and fail fast if it is missing in release mode.
	middleware.InitJWT()

	// Server configuration
	port := getEnv("PORT", "8080")
	publicHost := getEnv("PUBLIC_HOST", "localhost")
	ginMode := getEnv("GIN_MODE", "debug")

	// Set Gin mode
	gin.SetMode(ginMode)

	// Connect to database
	database.ConnectDB()

	// Seed built-in roles and permissions (idempotent)
	handlers.EnsureBuiltInRolesExist()

	// Initialize Gin router. gin.New() rather than gin.Default(): Default()
	// already installs a logger and a recovery handler, and both are added
	// again below, so every request was being logged twice.
	r := gin.New()

	// Don't trust X-Forwarded-For / X-Real-IP unless told which proxies to
	// trust. gin trusts every proxy by default, so any caller could spoof
	// their IP: dodging the login rate limit and forging the IP recorded in
	// the audit log. Set TRUSTED_PROXIES to a comma-separated list of proxy
	// IPs/CIDRs if you run behind a reverse proxy.
	if err := r.SetTrustedProxies(trustedProxies()); err != nil {
		log.Fatalf("Invalid TRUSTED_PROXIES: %v", err)
	}

	// Configure CORS
	configureCORS(r, publicHost, port)

	// Request logging middleware
	r.Use(gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		return param.TimeStamp.Format(time.RFC3339) + " | " +
			param.Method + " " + param.Path + " | " +
			param.ClientIP + " | " +
			param.Request.UserAgent() + " | " +
			param.ErrorMessage + "\n"
	}))

	// Recovery middleware
	r.Use(gin.Recovery())

	// Security headers
	// Was securityHeaders(false) hardcoded unconditionally — meaning
	// Strict-Transport-Security would never be set even if this is
	// deployed behind real TLS in production. Derived from an env var
	// instead, following the same getEnv pattern already used for PORT/
	// PUBLIC_HOST/GIN_MODE above.
	tlsEnabled := getEnv("TLS_ENABLED", "false") == "true"
	certFile := getEnv("TLS_CERT_FILE", "tls/cert.pem")
	keyFile := getEnv("TLS_KEY_FILE", "tls/key.pem")

	// Security headers
	r.Use(securityHeaders(tlsEnabled))

	// Register all routes
	routes.RegisterRoutes(r)

	// Serve the embedded React frontend with SPA (HTML5 history) fallback:
	// real files (assets, index.html) are served as-is, every other path
	// that is not an API/uploads path returns index.html so the router can
	// handle deep links. API /uploads routes are left untouched.
	web, err := fs.Sub(frontendDist, "frontend/dist")
	if err != nil {
		log.Fatalf("Embedded frontend missing: %v (run the frontend build first)", err)
	}
	registerFrontendRoutes(r, web)

	// In TLS mode the binary terminates HTTPS itself (as the build scripts
	// promise): it uses the certificates at TLS_CERT_FILE/TLS_KEY_FILE, and
	// auto-generates self-signed ones on first run if they are missing or
	// invalid. There is no nginx/caddy in front, so do the handshake here.
	if tlsEnabled {
		if err := ensureCertificates(certFile, keyFile); err != nil {
			log.Fatalf("TLS setup failed: %v", err)
		}
		log.Printf("Server starting with HTTPS on port %s (Gin mode: %s)", port, ginMode)
		if err := r.RunTLS(":"+port, certFile, keyFile); err != nil {
			log.Fatalf("Failed to start server: %v", err)
		}
		return
	}

	log.Printf("Server starting on port %s (Gin mode: %s)", port, ginMode)
	log.Printf("Build version: %s, Build time: %s", buildVersion, buildTime)

	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// getEnv gets an environment variable or returns a default value
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// ensureCertificates makes sure a usable key/cert pair exists at the given
// paths. If either file is missing or unreadable as a key pair, they are
// regenerated as a fresh self-signed certificate so the binary can serve
// HTTPS out of the box (this is the behaviour the build scripts advertise).
func ensureCertificates(certFile, keyFile string) error {
	if _, err := tls.LoadX509KeyPair(certFile, keyFile); err == nil {
		return nil
	}

	log.Println("TLS certificate missing or invalid, generating a self-signed certificate...")

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return err
	}

	tmpl := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "apex-core", Organization: []string{"Apex Core"}},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(3650 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost"},
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
	}

	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &priv.PublicKey, priv)
	if err != nil {
		return err
	}

	keyDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dirOf(certFile), 0o755); err != nil {
		return err
	}
	if err := writePEM(keyFile, "PRIVATE KEY", keyDER); err != nil {
		return err
	}
	if err := writePEM(certFile, "CERTIFICATE", der); err != nil {
		return err
	}

	log.Printf("Self-signed certificate written to %s / %s", keyFile, certFile)
	return nil
}

// dirOf returns the directory part of a file path.
func dirOf(path string) string {
	if i := strings.LastIndex(path, "/"); i >= 0 {
		return path[:i]
	}
	return "."
}

// writePEM writes a single PEM block to path with mode 0600.
func writePEM(path, blockType string, der []byte) error {
	data := pem.EncodeToMemory(&pem.Block{Type: blockType, Bytes: der})
	return os.WriteFile(path, data, 0o600)
}

// registerFrontendRoutes serves the embedded React build. Static assets are
// served directly; any non-API/non-uploads path that does not match a real
// file falls back to index.html so client-side routes (deep links) work.
func registerFrontendRoutes(r *gin.Engine, web fs.FS) {
	fileServer := http.FileServer(http.FS(web))
	indexHTML, err := fs.ReadFile(web, "index.html")
	if err != nil {
		log.Fatalf("index.html missing in frontend build: %v", err)
	}

	isAPI := func(p string) bool {
		return p == "/api" || strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/uploads/")
	}

	r.Use(func(c *gin.Context) {
		if isAPI(c.Request.URL.Path) {
			c.Next()
			return
		}
		// Serve the file if it exists (assets, index.html, favicon...).
		if f, err := web.Open(strings.TrimPrefix(c.Request.URL.Path, "/")); err == nil {
			f.Close()
			fileServer.ServeHTTP(c.Writer, c.Request)
			c.Abort()
			return
		}
		// Everything else is handled by NoRoute below.
		c.Next()
	})

	r.NoRoute(func(c *gin.Context) {
		if isAPI(c.Request.URL.Path) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
	})
}

// trustedProxies parses TRUSTED_PROXIES. Empty means trust none.
func trustedProxies() []string {
	raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
	if raw == "" {
		return nil
	}
	var out []string
	for _, p := range strings.Split(raw, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// configureCORS sets up CORS middleware
func configureCORS(r *gin.Engine, publicHost, port string) {
	origins := []string{
		"http://localhost:5173",
		"http://localhost:3000",
		"http://" + publicHost + ":" + port,
		"https://" + publicHost + ":" + port,
	}

	// Add Vite dev server defaults
	for _, scheme := range []string{"http", "https"} {
		base := scheme + "://" + publicHost
		origins = append(origins, base, base+":"+port)
	}

	r.Use(cors.New(cors.Config{
		AllowOrigins:     origins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-Requested-With"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))
}

// securityHeaders adds security headers to responses
func securityHeaders(tlsEnabled bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "SAMEORIGIN")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("X-XSS-Protection", "1; mode=block")
		if tlsEnabled {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		c.Next()
	}
}
