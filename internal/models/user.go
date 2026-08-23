package models

import (
	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	Name         string `json:"name"`
	Username     string `json:"username" gorm:"unique"`
	Email        string `json:"email" gorm:"unique"`
	Password     string `json:"-"`                               // Hidden from JSON responses
	Role         string `json:"role" gorm:"default:'Developer'"` // 'Admin' or 'Developer'
	Bio          string `json:"bio"`
	Skills       string `json:"skills"`       // Comma-separated or stringified
	Technologies string `json:"technologies"` // e.g., "Go, Gin, PostgreSQL"
	Status       string `json:"status" gorm:"default:'Active'"`
}
