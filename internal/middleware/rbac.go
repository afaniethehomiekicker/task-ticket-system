package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// AuthorizeRole checks if the user's role matches one of the allowed roles
func AuthorizeRole(allowedRoles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Assuming role is passed via header or session/JWT context for simplicity
		userRole := c.GetHeader("X-User-Role")

		if userRole == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized: Missing user role header"})
			c.Abort()
			return
		}

		// Super Admin bypasses all role checks
		if userRole == "Super Admin" {
			c.Next()
			return
		}

		allowed := false
		for _, role := range allowedRoles {
			if userRole == role {
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
