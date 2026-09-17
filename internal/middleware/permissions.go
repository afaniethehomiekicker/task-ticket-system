package middleware

import (
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// HasPermission is the single function every dynamic authorization check
// goes through. super_admin bypasses unconditionally — same as
// AuthorizeRole's existing behavior in rbac.go — so there is always at
// least one role that can never be locked out of anything by a matrix
// misconfiguration or an empty permissions table.
func HasPermission(roleKey, permissionKey string) bool {
	if roleKey == "super_admin" {
		return true
	}
	var perm models.RolePermission
	if err := database.DB.Where("role_key = ? AND permission_key = ?", roleKey, permissionKey).First(&perm).Error; err != nil {
		return false
	}
	return perm.Granted
}

// RequirePermission replaces a hardcoded AuthorizeRole("Admin",
// "Supervisor")-style route gate with a dynamic one: instead of checking
// whether the caller's role NAME is in a fixed list baked into the Go
// binary, it checks whether the caller's role has this specific
// capability GRANTED in the persisted permission matrix — the same
// matrix a Super Admin edits from the Settings & Matrix page. A newly
// created custom role can be granted exactly this capability without
// touching a single line of Go code or redeploying.
//
// Must run AFTER AuthenticateJWT — it reads the verified "userRole"
// value AuthenticateJWT already set on the context, never anything the
// client claims about itself. This is a deliberate, self-contained
// addition in its own file rather than an edit to rbac.go: it needs
// database access, and putting it in a new file avoids touching
// AuthorizeRole/AuthenticateJWT at all.
func RequirePermission(permissionKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		roleRaw, exists := c.Get("userRole")
		role, _ := roleRaw.(string)
		if !exists || role == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
			return
		}

		if !HasPermission(role, permissionKey) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "You don't have permission to perform this action"})
			return
		}

		c.Next()
	}
}
