package middleware

import (
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