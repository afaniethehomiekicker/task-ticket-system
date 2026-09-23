package models

import (
	"gorm.io/gorm"
)

type AuditLog struct {
	gorm.Model
	UserID       uint      `json:"user_id" gorm:"index"`
	User         *User     `json:"user,omitempty" gorm:"foreignKey:UserID"`
	Action       string    `json:"action" gorm:"index"`              // created, updated, deleted, status_changed, assigned, commented
	ResourceType string    `json:"resource_type" gorm:"index"`       // ticket, task, project, client, feasibility, user
	ResourceID   uint      `json:"resource_id" gorm:"index"`
	OldValues    string    `json:"old_values" gorm:"type:jsonb"`     // JSON snapshot before change
	NewValues    string    `json:"new_values" gorm:"type:jsonb"`     // JSON snapshot after change
	Details      string    `json:"details"`                          // human-readable description
	IPAddress    string    `json:"ip_address"`
	UserAgent    string    `json:"user_agent"`
}