package routes

import (
	"task-ticket-backend/internal/handlers"
	"task-ticket-backend/internal/middleware"

	"github.com/gin-gonic/gin"
)

func RegisterRoutes(r *gin.Engine) {
	// Serve static avatar uploads directly from the disk
	r.Static("/uploads", "./uploads")

	api := r.Group("/api")
	{
		// Health check
		api.GET("/health", func(c *gin.Context) {
			c.JSON(200, gin.H{"status": "backend is running smoothly"})
		})

		// Auth endpoints
		api.POST("/auth/register", handlers.Register)
		api.POST("/auth/login", handlers.Login)

		// File Upload endpoint
		api.POST("/upload", handlers.UploadAvatar)

		// User management endpoints
		api.GET("/users", handlers.GetUsers)

		// Project endpoints
		api.GET("/projects", handlers.GetProjects)
		api.PUT("/projects/:id", handlers.UpdateProject)

		// Task endpoints
		api.GET("/tasks", handlers.GetTasks)
		api.POST("/tasks", handlers.CreateTask)
		api.PUT("/tasks/:id", handlers.UpdateTask)
		api.PATCH("/tasks/:id/status", handlers.UpdateTaskStatus)
		api.DELETE("/tasks/:id", handlers.DeleteTask)

		// Ticket endpoints
		api.GET("/tickets", handlers.GetTickets)
		api.POST("/tickets", handlers.CreateTicket)
		api.PUT("/tickets/:id", handlers.UpdateTicket)
		api.PATCH("/tickets/:id/status", handlers.UpdateTicketStatus)
		api.PATCH("/tickets/:id/escalate", handlers.EscalateTicket)
		api.DELETE("/tickets/:id", handlers.DeleteTicket)

		// Sub-task endpoints
		api.GET("/subtasks", handlers.GetSubTasks)
		api.POST("/subtasks", handlers.CreateSubTask)
		api.PATCH("/subtasks/:id/status", handlers.UpdateSubTaskStatus)

		// Team Collaboration & Comments endpoints
		api.GET("/comments", handlers.GetComments)
		api.POST("/comments", handlers.CreateComment)

		// Reports & Search
		api.GET("/search", handlers.GlobalSearch)
		api.GET("/reports/summary", handlers.GetSystemReport)

		// Protected Admin / Super Admin routes
		adminGroup := api.Group("/")
		adminGroup.Use(middleware.AuthorizeRole("Super Admin", "Admin"))
		{
			adminGroup.POST("/projects", handlers.CreateProject)
			adminGroup.DELETE("/projects/:id", handlers.DeleteProject)
			adminGroup.GET("/audit-logs", handlers.GetAuditLogs)
		}
	}
}
