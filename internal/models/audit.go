package models

import (
	"gorm.io/gorm"
)

type AuditLog struct {
	gorm.Model
	UserID       uint   `json:"user_id"`
	User         User   `json:"user" gorm:"foreignKey:UserID"`
	Action       string `json:"action"`        // e.g., "CREATE", "UPDATE_STATUS", "DELETE"
	ResourceType string `json:"resource_type"` // e.g., "Task", "Ticket", "Project"
	ResourceID   uint   `json:"resource_id"`
	Details      string `json:"details"`
}
