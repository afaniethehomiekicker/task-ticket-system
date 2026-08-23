package models

import (
	"time"

	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	Name       string    `json:"name" gorm:"not null"`
	Username   string    `json:"username" gorm:"unique;not null"`
	Email      string    `json:"email" gorm:"unique;not null"`
	Password   string    `json:"-" gorm:"not null"`
	Role       string    `json:"role" gorm:"default:'Developer';not null"`
	Status     string    `json:"status" gorm:"default:'Active'"`
	Reputation int       `json:"reputation" gorm:"default:0"`
	LastLogin  time.Time `json:"last_login"`
}
