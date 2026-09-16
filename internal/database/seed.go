package database

import (
	"log"
	"task-ticket-backend/internal/models"

	"golang.org/x/crypto/bcrypt"
)

func SeedSuperAdmin() {
	var count int64
	DB.Model(&models.User{}).Where("role = ?", "super_admin").Count(&count)

	if count > 0 {
		log.Println("Super Admin already exists. Skipping seed.")
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte("superadmin123"), bcrypt.DefaultCost)
	if err != nil {
		log.Fatal("Failed to hash super admin password: ", err)
	}

	superAdmin := models.User{
		Name:     "Super Admin",
		Email:    "superadmin@example.com",
		Password: string(hashedPassword),
		Role:     "super_admin",
	}

	if err := DB.Create(&superAdmin).Error; err != nil {
		log.Fatal("Failed to seed super admin: ", err)
	}

	log.Println("Super Admin seeded successfully.")
}
