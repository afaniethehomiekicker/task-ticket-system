package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/routes"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

//go:embed frontend/dist/*
var frontendFiles embed.FS

// Overridden at build time (see build.sh):
// go build -ldflags "-X 'main.buildVersion=...'"
var buildVersion = "dev"

const (
	envPort       = "PORT"
	envPublicHost = "PUBLIC_HOST"

	// envTLSCert/envTLSKey: when both are set, the server serves HTTPS.
	// Leave both empty for plain-HTTP development mode.
	envTLSCert = "TLS_CERT_FILE"
	envTLSKey  = "TLS_KEY_FILE"
	// envHTTPRedirectPort is optional: when TLS is enabled, this plain-HTTP
	// port (e.g. "80") redirects every request to the HTTPS listener. Leave
	// empty to serve ONLY HTTPS (clients that hit :80 get a refusal).
	envHTTPRedirectPort = "HTTP_REDIRECT_PORT"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, relying on system environment")
	}

	// Network identity — read once from the single .env source of truth.
	// PORT and PUBLIC_HOST drive every listener, the CORS allow-list, and
	// (via the same file, read by vite) the development proxy target. Change
	// one variable and the whole application follows.
	port := os.Getenv(envPort)
	if port == "" {
		port = "8084"
	}
	publicHost := os.Getenv(envPublicHost)
	if publicHost == "" {
		publicHost = "localhost"
	}

	database.ConnectDB()

	r := gin.Default()

	origins := []string{"http://localhost:5173", "http://localhost:3000"}
	for _, scheme := range []string{"http", "https"} {
		base := scheme + "://" + publicHost
		origins = append(origins, base, base+":"+port)
	}
	r.Use(cors.New(cors.Config{
		AllowOrigins:     origins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "x-user-role", "x-user-id"},
		AllowCredentials: true,
	}))
	tlsCert, tlsKey := os.Getenv(envTLSCert), os.Getenv(envTLSKey)
	tlsEnabled := tlsCert != "" && tlsKey != ""
	r.Use(securityHeaders(tlsEnabled))

	routes.RegisterRoutes(r)

	// Setup embedded frontend file system
	subFS, err := fs.Sub(frontendFiles, "frontend/dist")
	if err != nil {
		log.Fatal("Failed to sub embed filesystem: ", err)
	}

	// Serve the web interface and handle SPA routing cleanly.
	// Non-API paths resolve against the embedded bundle; anything not
	// found falls back to index.html (client-side routes / deep links).
	r.Use(func(c *gin.Context) {
		path := c.Request.URL.Path
		if len(path) >= 4 && path[:4] == "/api" {
			c.Next()
			return
		}

		fPath := path
		if len(fPath) > 0 && fPath[0] == '/' {
			fPath = fPath[1:]
		}
		if fPath == "" {
			fPath = "index.html"
		}

		if f, err := subFS.Open(fPath); err == nil {
			f.Close()
			http.FileServer(http.FS(subFS)).ServeHTTP(c.Writer, c.Request)
			c.Abort()
			return
		}

		indexHTML, err := fs.ReadFile(subFS, "index.html")
		if err != nil {
			c.String(404, "index.html not found in embed")
			return
		}
		c.Data(200, "text/html; charset=utf-8", indexHTML)
		c.Abort()
	})

	describe := func() string {
		if buildVersion == "" || buildVersion == "dev" {
			return "development build"
		}
		return "build " + buildVersion
	}

	if tlsEnabled {
		if redirectPort := os.Getenv(envHTTPRedirectPort); redirectPort != "" {
			go startHTTPRedirect(redirectPort)
		}
		log.Printf("APEX CORE (%s) serving HTTPS on :%s (TLS cert=%s key=%s)", describe(), port, tlsCert, tlsKey)
		if err := r.RunTLS(":"+port, tlsCert, tlsKey); err != nil {
			log.Fatalf("Failed to start HTTPS server: %v", err)
		}
		return
	}

	log.Printf("APEX CORE (%s) serving plain HTTP on :%s (development mode — set %s and %s for HTTPS)", describe(), port, envTLSCert, envTLSKey)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// startHTTPRedirect runs a minimal plain-HTTP listener whose only job is
// to 301-redirect browsers to the same host/path over HTTPS — the typical
// "port 80 → port 443" enforcement in front of the single binary.
// NoRoute is used rather than a wildcard route so EVERY path and method is
// redirected unconditionally.
func startHTTPRedirect(port string) {
	redir := gin.New()
	redir.NoRoute(func(c *gin.Context) {
		target := "https://" + c.Request.Host + c.Request.RequestURI
		c.Redirect(http.StatusMovedPermanently, target)
	})
	log.Printf("HTTP→HTTPS redirect listening on :%s", port)
	if err := redir.Run(":" + port); err != nil {
		log.Printf("HTTP redirect listener stopped: %v", err)
	}
}

// securityHeaders hardens every response. Heading-strict-transport-security
// (HSTS) is only advertised when THIS process actually terminates TLS —
// advertising it over plain HTTP would make browsers refuse future
// connections to the host, breaking development mode.
func securityHeaders(tlsEnabled bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "SAMEORIGIN")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		ri := c.GetHeader("X-Forwarded-Proto")
		if tlsEnabled || strings.EqualFold(ri, "https") {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		c.Next()
	}
}
