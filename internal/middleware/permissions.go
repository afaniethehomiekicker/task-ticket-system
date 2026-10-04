package middleware

import (
	"sort"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
)

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

// grantedPermissions returns the permission keys granted to a role.
func grantedPermissions(roleKey string) map[string]bool {
	var rows []models.RolePermission
	database.DB.Where("role_key = ? AND granted = ?", roleKey, true).Find(&rows)
	out := make(map[string]bool, len(rows))
	for _, r := range rows {
		out[r.PermissionKey] = true
	}
	return out
}

// PermissionsBeyond lists the permissions roleKey has that callerRole does
// not — empty when roleKey sits at or below the caller. It is the "you can
// only hand out what you have yourself" rule behind every role assignment and
// matrix edit (issue: anyone with manage_users could give users a role more
// powerful than their own, or create one, and then log in as that user).
//
//   - a super admin is above everything: always empty;
//   - nobody else can reach super_admin: it returns ["super_admin"].
func PermissionsBeyond(callerRole, roleKey string) []string {
	if callerRole == "super_admin" {
		return nil
	}
	if roleKey == "super_admin" {
		return []string{"super_admin"}
	}
	if roleKey == callerRole {
		return nil
	}
	mine := grantedPermissions(callerRole)
	var extra []string
	for key := range grantedPermissions(roleKey) {
		if !mine[key] {
			extra = append(extra, key)
		}
	}
	sort.Strings(extra)
	return extra
}