package main

import (
	"log"
	"os"

	"devissues/internal/config"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables from the .env file
	err := godotenv.Load(".env")
	if err != nil {
		log.Println("Warning: .env file not found, reading from system environment variables")
	}

	// Connect to the database and run auto-migrations
	config.ConnectDB()

	// Initialize Gin router
	r := gin.Default()

	// A simple test route to verify the server is working
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":  "success",
			"message": "Developer Issues & Solutions API is running smoothly!",
		})
	})

	// Get port from environment or default to 8080
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server is starting on port %s...", port)
	r.Run(":" + port)
}
