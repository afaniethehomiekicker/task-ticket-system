package main

import (
	"log"
	"os"
	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/routes"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, relying on system environment")
	}

	database.ConnectDB()

	err := database.DB.AutoMigrate(
		&models.User{},
		&models.Project{},
		&models.Task{},
		&models.Ticket{},
		&models.SubTask{},
		&models.Comment{},
		&models.AuditLog{},
	)
	if err != nil {
		log.Fatal("Migration failed: ", err)
	}

	r := gin.Default()

	// Configure and add CORS middleware so React can talk to the backend
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:5173"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "x-user-role"},
		AllowCredentials: true,
	}))

	routes.RegisterRoutes(r)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server running smoothly on port %s...", port)
	r.Run(":" + port)
}
