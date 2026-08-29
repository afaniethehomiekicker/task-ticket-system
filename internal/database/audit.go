package database

import "task-ticket-backend/internal/models"

func LogAction(userID uint, action, resourceType string, resourceID uint, details string) {
	logEntry := models.AuditLog{
		UserID:       userID,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Details:      details,
	}
	DB.Create(&logEntry)
}
