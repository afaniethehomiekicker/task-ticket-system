package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"embed"
	"encoding/pem"
	"fmt"
	"io/fs"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/handlers"
	"task-ticket-backend/internal/routes"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

//go:embed frontend/dist/*
var frontendFiles embed.FS

// Overridden at build time (see build.sh):
//
//	go build -ldflags "-X 'main.buildVersion=...'"
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

	defaultTLSCert = "tls/cert.pem"
	defaultTLSKey  = "tls/key.pem"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, relying on system environment")
	}

	// Network identity — read once from the single .env source of truth.
	port := os.Getenv(envPort)
	if port == "" {
		port = "8084"
	}
	publicHost := os.Getenv(envPublicHost)
	if publicHost == "" {
		publicHost = "localhost"
	}

	database.ConnectDB()

	// Seeds the four built-in Role rows (idempotent) so GET /api/roles
	// has real data from first boot, before anyone creates a custom
	// role. See EnsureBuiltInRolesExist in role.go for why this exists.
	handlers.EnsureBuiltInRolesExist()

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

	// ── TLS resolution ──────────────────────────────────────────────
	// Dev builds (buildVersion == "dev", i.e. `go run main.go`) always
	// use plain HTTP — TLS env vars are intentionally ignored so there
	// is zero certificate overhead during local development.
	//
	// Production builds (buildVersion != "dev") read TLS_CERT_FILE /
	// TLS_KEY_FILE from the environment. When both are empty the binary
	// falls back to the default paths tls/cert.pem / tls/key.pem in the
	// working directory and auto-generates self-signed certificates if
	// they don't exist yet.
	tlsCert, tlsKey := resolveTLSPaths()
	tlsEnabled := tlsCert != "" && tlsKey != ""

	if tlsEnabled {
		ensureSelfSignedCert(tlsCert, tlsKey)
	}

	r.Use(securityHeaders(tlsEnabled))

	routes.RegisterRoutes(r)

	// Setup embedded frontend file system
	subFS, err := fs.Sub(frontendFiles, "frontend/dist")
	if err != nil {
		log.Fatal("Failed to sub embed filesystem: ", err)
	}

	// Serve the web interface and handle SPA routing cleanly.
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

// resolveTLSPaths decides which TLS certificate / key to use.
//
//   - Dev builds (buildVersion == "dev"): always returns ("", "") so the
//     server runs plain HTTP. TLS env vars are deliberately ignored.
//   - Production builds: reads TLS_CERT_FILE / TLS_KEY_FILE. When both
//     are empty, falls back to the default tls/cert.pem and tls/key.pem
//     paths so the server can auto-generate self-signed certificates.
func resolveTLSPaths() (cert, key string) {
	if buildVersion == "" || buildVersion == "dev" {
		return "", ""
	}

	cert = os.Getenv(envTLSCert)
	key = os.Getenv(envTLSKey)

	if cert == "" && key == "" {
		cert = defaultTLSCert
		key = defaultTLSKey
	}

	if cert != "" && key != "" {
		return cert, key
	}
	return "", ""
}

// ensureSelfSignedCert checks whether certPath and keyPath contain a valid
// TLS key pair. If either file is missing or fails to parse — e.g. a
// corrupt/truncated placeholder — a fresh self-signed certificate is
// generated using pure Go (no openssl dependency at runtime).
func ensureSelfSignedCert(certPath, keyPath string) {
	if _, err := tls.LoadX509KeyPair(certPath, keyPath); err == nil {
		return // valid, usable key pair
	}

	log.Println("TLS certificates missing or invalid — generating self-signed certificates…")

	if err := generateSelfSignedCert(certPath, keyPath); err != nil {
		log.Fatalf("Failed to generate self-signed TLS certificates: %v", err)
	}

	log.Printf("  cert: %s", certPath)
	log.Printf("  key:  %s", keyPath)
	log.Println("  NOTE: self-signed certs are for testing only. Replace with CA-signed certificates for production.")
}

// generateSelfSignedCert creates a self-signed X.509 certificate and
// corresponding ECDSA private key, writing them to disk as PEM files.
func generateSelfSignedCert(certPath, keyPath string) error {
	if err := os.MkdirAll(filepath.Dir(certPath), 0o755); err != nil {
		return fmt.Errorf("create tls directory: %w", err)
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("generate key: %w", err)
	}

	serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return fmt.Errorf("generate serial: %w", err)
	}

	notBefore := time.Now()
	notAfter := notBefore.Add(365 * 24 * time.Hour)

	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			Organization: []string{"APEX CORE"},
			CommonName:   "apex-core.local",
		},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost", "apex-core.local"},
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
	}

	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		return fmt.Errorf("create certificate: %w", err)
	}

	certFile, err := os.Create(certPath)
	if err != nil {
		return fmt.Errorf("create cert file: %w", err)
	}
	defer certFile.Close()
	if err := pem.Encode(certFile, &pem.Block{Type: "CERTIFICATE", Bytes: certDER}); err != nil {
		return fmt.Errorf("write cert: %w", err)
	}

	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return fmt.Errorf("marshal key: %w", err)
	}
	keyFile, err := os.Create(keyPath)
	if err != nil {
		return fmt.Errorf("create key file: %w", err)
	}
	defer keyFile.Close()
	if err := pem.Encode(keyFile, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}); err != nil {
		return fmt.Errorf("write key: %w", err)
	}

	return nil
}

// startHTTPRedirect runs a minimal plain-HTTP listener whose only job is
// to 301-redirect browsers to the same host/path over HTTPS.
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

// securityHeaders hardens every response. HSTS is only advertised when
// TLS is active.
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
