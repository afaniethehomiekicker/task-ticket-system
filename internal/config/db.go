package config

import (
	"fmt"
	"log"
	"os"

	"devissues/internal/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func ConnectDB() {
	// 1. Connect to default postgres database first to create our app database
	dsn := fmt.Sprintf(
		"host=%s user=%s password=%s dbname=postgres port=%s sslmode=%s",
		os.Getenv("DB_HOST"),
		os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_PORT"),
		os.Getenv("DB_SSLMODE"),
	)

	tempDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to PostgreSQL server: %v", err)
	}

	// Create database if it doesn't exist
	err = tempDB.Exec("CREATE DATABASE dev_issues_db;").Error
	if err != nil {
		log.Println("Note: Database 'dev_issues_db' might already exist or was created.")
	} else {
		log.Println("Database 'dev_issues_db' created successfully!")
	}

	// 2. Now connect to the actual 'dev_issues_db'
	appDsn := fmt.Sprintf(
		"host=%s user=%s password=%s dbname=dev_issues_db port=%s sslmode=%s",
		os.Getenv("DB_HOST"),
		os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_PORT"),
		os.Getenv("DB_SSLMODE"),
	)

	DB, err = gorm.Open(postgres.Open(appDsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to dev_issues_db: %v", err)
	}

	log.Println("Database connection established successfully.")

	// Auto-Migrate Models
	err = DB.AutoMigrate(
		&models.User{},
	)
	if err != nil {
		log.Fatalf("Failed to run auto-migration: %v", err)
	}
	log.Println("Database migration completed.")
}
