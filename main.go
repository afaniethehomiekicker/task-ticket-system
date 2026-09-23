package main

import (
	"log"
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
	r.Use(securityHeaders(tlsEnabled))

	// Register all routes
	routes.RegisterRoutes(r)

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
