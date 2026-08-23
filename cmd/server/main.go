package main

import (
	"log"
	"os"

	"devissues/internal/config"
	"devissues/internal/controllers"
	"devissues/internal/middleware"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables
	err := godotenv.Load(".env")
	if err != nil {
		log.Println("Warning: .env file not found, reading from system environment variables")
	}

	// Connect to Database & Run Auto-Migrations
	db := config.ConnectDB()

	// Initialize Gin router
	r := gin.Default()

	// Health check endpoint
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "Server is running smoothly!"})
	})

	// Authentication Routes
	r.POST("/api/auth/register", controllers.Register(db))
	r.POST("/api/auth/login", controllers.Login(db))

	// Public Issues Route (Anyone can view issues)
	r.GET("/api/issues", controllers.GetIssues(db))
	r.GET("/api/activities", controllers.GetActivities(db))

	// Protected Routes Group
	protected := r.Group("/api")
	protected.Use(middleware.AuthMiddleware())
	protected.POST("/api/reports", controllers.CreateReport(db))
	{
		protected.GET("/protected-test", func(c *gin.Context) {
			email, _ := c.Get("email")
			role, _ := c.Get("role")
			c.JSON(200, gin.H{
				"message": "You have successfully accessed a protected route!",
				"email":   email,
				"role":    role,
			})
		})

		// Protected Issue Creation Route (Requires JWT token)
		protected.POST("/issues", controllers.CreateIssue(db))
		protected.POST("/issues/:id/comments", controllers.AddComment(db))
		protected.POST("/issues/:id/solutions", controllers.SubmitSolution(db))
		protected.POST("/issues/:id/bookmark", controllers.ToggleBookmark(db))
	}

	// Get port from environment or default to 8080
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server is starting on port %s...", port)
	r.Run(":" + port)
}
