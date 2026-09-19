package middleware

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// jwtSecret is read once from the environment. In production this MUST be
// set to a long, random value via the JWT_SECRET env var — the fallback
// below exists only so local/dev environments don't crash on missing
// config, and it is deliberately obvious in logs that it's insecure.
var jwtSecret = []byte(getJWTSecret())

func getJWTSecret() string {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return "INSECURE_DEV_ONLY_CHANGE_ME"
	}
	return secret
}

type Claims struct {
	UserID uint   `json:"user_id"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

// GenerateToken creates a signed JWT for a successfully authenticated
// user. Called from handlers.Login after bcrypt verification succeeds —
// this is the ONLY place a token should ever be minted.
func GenerateToken(userID uint, role string) (string, error) {
	claims := Claims{
		UserID: userID,
		Role:   role,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

// AuthenticateJWT verifies the Authorization: Bearer <token> header against
// a real signed token this server issued, and — only on success — stores
// the verified user id and role on the Gin context for downstream
// handlers/middleware (AuthorizeRole below) to read. This replaces trusting
// a client-supplied X-User-Role header, which is inherently forgeable:
// nothing stops any request from setting that header to whatever it wants,
// regardless of whether the caller ever authenticated.
func AuthenticateJWT() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized: Missing or malformed Authorization header"})
			c.Abort()
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")

		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
			return jwtSecret, nil
		})

		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized: Invalid or expired token"})
			c.Abort()
			return
		}

		c.Set("userID", claims.UserID)
		c.Set("userRole", claims.Role)
		c.Next()
	}
}

// AuthorizeRole checks the ROLE FROM THE VERIFIED TOKEN (set by
// AuthenticateJWT, above) against the allowed roles for this route. Must
// run after AuthenticateJWT in the middleware chain — see routes.go.
//
// Comparison is case-insensitive as a defensive stopgap: the only
	// seeded account (database.SeedSuperAdmin) uses "super_admin" and the
	// rest of the codebase standardizes on that casing, but a
	// case-insensitive check is cheap insurance against any future casing
	// drift silently locking legitimate users out.
func AuthorizeRole(allowedRoles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userRole, exists := c.Get("userRole")
		if !exists {
			// Should be unreachable if AuthenticateJWT ran first, but
			// fail closed rather than assume.
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized: No authenticated role on request"})
			c.Abort()
			return
		}

		roleStr, _ := userRole.(string)

		// Super Admin bypasses all role checks, regardless of casing.
		if strings.EqualFold(roleStr, "super_admin") || strings.EqualFold(roleStr, "Super Admin") {
			c.Next()
			return
		}

		allowed := false
		for _, role := range allowedRoles {
			if strings.EqualFold(roleStr, role) {
				allowed = true
				break
			}
		}

		if !allowed {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden: Insufficient permissions for this action"})
			c.Abort()
			return
		}

		c.Next()
	}
}
