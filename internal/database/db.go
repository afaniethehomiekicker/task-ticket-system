package database

import (
	"log"
	"os"
	"time"

	"task-ticket-backend/internal/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func ConnectDB() {
	dsn := os.Getenv("DB_DSN")

	// Custom GORM logger suppressing "record not found" logs
	newLogger := logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             time.Second,
			LogLevel:                  logger.Warn,
			IgnoreRecordNotFoundError: true,
		},
	)

	var err error
	DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: newLogger,
	})
	if err != nil {
		log.Fatal("Failed to connect to database: ", err)
	}

	// Auto-migrate all models including SubTasks and Comments
	err = DB.AutoMigrate(
		&models.User{},
		&models.Project{},
		&models.Task{},
		&models.Ticket{},
		&models.SubTask{},
		&models.Comment{},
	)
	if err != nil {
		log.Fatal("Failed to auto-migrate database: ", err)
	}
	// Call the seed function here
	SeedSuperAdmin()

	log.Println("Database connection and auto-migration established successfully.")
}
