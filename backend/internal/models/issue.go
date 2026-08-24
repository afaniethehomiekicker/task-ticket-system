package models

import (
	"gorm.io/gorm"
)

type Issue struct {
	gorm.Model
	Title       string    `json:"title" binding:"required"`
	Description string    `json:"description"`
	Status      string    `json:"status" gorm:"default:'Open'"`
	UserID      uint      `json:"user_id"`
	User        User      `json:"user,omitempty"`
	Comments    []Comment `json:"comments" gorm:"foreignKey:IssueID"` // Add this line!
}
