package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// TokenLifetime is how long an issued JWT is valid for before it must be
// re-obtained via login. (Previously there was no expiry at all.)
const TokenLifetime = 24 * time.Hour

// The signing key is resolved on FIRST USE, not at package initialisation.
//
// It used to be `var jwtSecret = []byte(getJWTSecret())`. Package-level
// variables are initialised before main() runs, and main() is what calls
// godotenv.Load() — so a JWT_SECRET defined in your .env file was never
// visible here, and the server silently signed every token with the
// publicly-known fallback key even though you had set a real secret. (The
// database settings didn't have this problem because ConnectDB reads them
// after Load.) Call InitJWT() from main() right after godotenv.Load() to
// resolve it — and report problems — at startup rather than on the first login.
var (
	secretOnce sync.Once
	secretKey  []byte
)

func signingKey() []byte {
	secretOnce.Do(func() {
		key, warning, err := resolveJWTSecret(os.Getenv("JWT_SECRET"), os.Getenv("GIN_MODE"))
		if err != nil {
			log.Fatal(err)
		}
		if warning != "" {
			log.Println("========================================================")
			log.Println(warning)
			log.Println("========================================================")
		}
		secretKey = key
	})
	return secretKey
}

// InitJWT resolves the signing key now. Call it from main() after
// godotenv.Load().
func InitJWT() { signingKey() }

// resolveJWTSecret decides the signing key. It never falls back to a fixed,
// publicly-known string:
//   - set                 -> used (with a warning if it is short)
//   - unset, release mode -> error (refuse to start)
//   - unset, otherwise    -> a random per-process key, so nothing in the source
//     can forge a token, at the cost of every session ending when the server
//     restarts. Fine for development; set JWT_SECRET to keep sessions.
func resolveJWTSecret(secret, ginMode string) (key []byte, warning string, err error) {
	if secret != "" {
		if len(secret) < 32 {
			warning = "WARNING: JWT_SECRET is shorter than 32 characters. Use a long random value (e.g. `openssl rand -hex 32`)."
		}
		return []byte(secret), warning, nil
	}
	if ginMode == "release" {
		return nil, "", errors.New("JWT_SECRET is not set: refusing to start in release mode without a signing key")
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return nil, "", err
	}
	return []byte(hex.EncodeToString(buf)), "WARNING: JWT_SECRET is not set. Using a random key for this run only:\nevery login is invalidated when the server restarts. Set JWT_SECRET to fix that.", nil
}

type Claims struct {
	UserID     uint   `json:"user_id"`
	Role       string `json:"role"`
	Department string `json:"department"`
	jwt.RegisteredClaims
}

func GenerateToken(user *models.User) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:     user.ID,
		Role:       user.Role,
		Department: user.Department,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(TokenLifetime)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(signingKey())
}

// parseToken validates a bearer token: HS256 only (the library would otherwise
// accept whatever algorithm the token names) and an expiry is required, so a
// token without one can never be valid forever.
func parseToken(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		return signingKey(), nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

// authenticateAndSetContext is the one real implementation behind
// AuthenticateJWT — previously this codebase had TWO middleware
// functions doing almost the same thing: a plain AuthenticateJWT that
// trusted whatever Role/Department was baked into the token at login,
// and a AuthenticateJWTWithRefresh that correctly re-read the user's
// current data from the database, but was never actually wired up
// anywhere (routes.go calls the plain version everywhere). That meant a
// demoted Admin, a transferred department, or an account disabled via
// ToggleUserStatus all kept their OLD access for as long as their token
// stayed valid — which, with no expiry set either, meant indefinitely.
//
// Now there is only one behavior: every protected request re-reads the
// user's current role/department/status from the database. This costs
// one extra query per request, which is the right tradeoff for a system
// whose entire spec is built around department-scoped privacy and
// deactivation actually taking effect.
func authenticateAndSetContext(c *gin.Context) {
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized: Missing or malformed Authorization header"})
		c.Abort()
		return
	}

	tokenString := strings.TrimPrefix(authHeader, "Bearer ")

	claims, err := parseToken(tokenString)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized: Invalid or expired token"})
		c.Abort()
		return
	}

	var user models.User
	if err := database.DB.First(&user, claims.UserID).Error; err != nil {
		// The account this token was issued for no longer exists.
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized: Account no longer exists"})
		c.Abort()
		return
	}
	if user.Status != "active" {
		// Closes the exact gap described above: ToggleUserStatus takes
		// effect on the very next request, not "whenever the token
		// happens to expire" (which, before this fix, was never).
		c.JSON(http.StatusForbidden, gin.H{"error": "Account is disabled"})
		c.Abort()
		return
	}

	c.Set("user_id", user.ID)
	c.Set("user_role", user.Role)
	c.Set("user_department", user.Department)
	c.Next()
}

func AuthenticateJWT() gin.HandlerFunc {
	return authenticateAndSetContext
}

// Deprecated: kept only so any existing call site referencing this name
// by itself doesn't break. AuthenticateJWT now always does what this
// used to do exclusively — there is no longer a "without refresh"
// variant to choose instead.
func AuthenticateJWTWithRefresh() gin.HandlerFunc {
	return authenticateAndSetContext
}

// RequireRole checks if the user has one of the required roles
func RequireRole(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		roleVal, exists := c.Get("user_role")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			c.Abort()
			return
		}
		userRole := roleVal.(string)

		allowed := false
		for _, r := range roles {
			if userRole == r {
				allowed = true
				break
			}
		}

		if !allowed {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden: Insufficient role"})
			c.Abort()
			return
		}
		c.Next()
	}
}

// RequirePermission checks if the user's role has a specific permission
func RequirePermission(permissionKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		roleVal, exists := c.Get("user_role")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			c.Abort()
			return
		}
		userRole := roleVal.(string)

		// Super admin bypasses all permission checks
		if userRole == "super_admin" {
			c.Next()
			return
		}

		var perm models.RolePermission
		if err := database.DB.Where("role_key = ? AND permission_key = ? AND granted = ?", userRole, permissionKey, true).First(&perm).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden: Missing required permission: " + permissionKey})
			c.Abort()
			return
		}
		c.Next()
	}
}

// RequireDepartment checks if the user belongs to one of the allowed departments
func RequireDepartment(departments ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		deptVal, exists := c.Get("user_department")
		if !exists {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden: No department assigned"})
			c.Abort()
			return
		}
		userDept := deptVal.(string)

		allowed := false
		for _, d := range departments {
			if userDept == d {
				allowed = true
				break
			}
		}

		if !allowed {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden: Access restricted to specific departments"})
			c.Abort()
			return
		}
		c.Next()
	}
}
