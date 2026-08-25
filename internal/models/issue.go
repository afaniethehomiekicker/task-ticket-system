package models

import (
	"gorm.io/gorm"
)

type Issue struct {
	gorm.Model
	Title       string `json:"title"`
	Category    string `json:"category"`
	Technology  string `json:"technology"`
	Priority    string `json:"priority"`
	Description string `json:"description"`
	Status      string `json:"status"`
	UserID      uint   `json:"user_id"`
	User        User   `json:"user"`
}
