package models

import (
	"gorm.io/gorm"
)

type Issue struct {
	gorm.Model
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	Status      string `json:"status" gorm:"default:'Open'"` // Open, In Progress, Closed
	UserID      uint   `json:"user_id"`                      // Foreign key to User
	User        User   `json:"user,omitempty"`               // Association so we can fetch creator details
}
