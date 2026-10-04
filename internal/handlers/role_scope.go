package handlers

import (
	"fmt"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/middleware"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// Role scoping: you can only hand out — or change — what you have yourself.
//
// Before this, anyone holding manage_users could give a user ANY role except
// super_admin, including a custom role with more permissions than their own,
// then set that user's password and sign in as them. With
// manage_matrix_permissions as well, they could first create such a role and
// grant it everything. A super admin is unaffected by every check here.

// roleLabel is a role's display name (its key when it has none).
func roleLabel(key string) string {
	var r models.Role
	if database.DB.Select("label").Where("key = ?", key).First(&r).Error == nil && strings.TrimSpace(r.Label) != "" {
		return r.Label
	}
	return key
}

// permissionList turns permission keys into their readable labels.
func permissionList(keys []string) string {
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		if l, ok := PermissionLabels[k]; ok {
			out = append(out, l)
		} else {
			out = append(out, k)
		}
	}
	return strings.Join(out, ", ")
}

// roleAssignError refuses giving a user roleKey when it carries permissions
// the caller's own role lacks. Returns "" when allowed.
func roleAssignError(c *gin.Context, roleKey string) string {
	extra := middleware.PermissionsBeyond(viewerFrom(c).Role, roleKey)
	if len(extra) == 0 {
		return ""
	}
	if extra[0] == "super_admin" {
		return "Only a super admin can assign or change the super admin role"
	}
	return fmt.Sprintf("You can't assign the %s role: it has permissions your own role doesn't (%s)",
		roleLabel(roleKey), permissionList(extra))
}

// roleEditError refuses changing a role (its permissions, label, or deleting
// it) when that role carries permissions the caller's own role lacks.
func roleEditError(c *gin.Context, roleKey string) string {
	extra := middleware.PermissionsBeyond(viewerFrom(c).Role, roleKey)
	if len(extra) == 0 {
		return ""
	}
	if extra[0] == "super_admin" {
		return "Only a super admin can change the super admin role"
	}
	return fmt.Sprintf("You can't change the %s role: it has permissions your own role doesn't (%s)",
		roleLabel(roleKey), permissionList(extra))
}