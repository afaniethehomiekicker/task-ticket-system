package database

import "task-ticket-backend/internal/models"

func LogAction(userID uint, action, resourceType string, resourceID uint, details string) {
	var actor *uint
	if userID != 0 {
		actor = &userID
	}
	logEntry := models.AuditLog{
		UserID:       actor,
		OldValues:    "{}", // jsonb: "" would be rejected by Postgres
		NewValues:    "{}",
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Details:      details,
	}
	DB.Create(&logEntry)
}
