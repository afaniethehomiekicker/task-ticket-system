package routes

import (
	"task-ticket-backend/internal/handlers"
	"task-ticket-backend/internal/middleware"

	"github.com/gin-gonic/gin"
)

func RegisterRoutes(r *gin.Engine) {
	api := r.Group("/api")
	{
		api.GET("/health", func(c *gin.Context) {
			c.JSON(200, gin.H{"status": "backend is running smoothly"})
		})

		// Auth endpoints
		api.POST("/auth/register", handlers.Register)
		api.POST("/auth/login", handlers.Login)

		// User endpoints
		api.GET("/users", handlers.GetUsers)

		// Project endpoints (Public/General read if needed, or remove GET if admin-only)
		api.GET("/projects", handlers.GetProjects)

		// Task and Kanban endpoints
		api.POST("/tasks", handlers.CreateTask)
		api.GET("/tasks", handlers.GetTasks)
		api.PATCH("/tasks/:id/status", handlers.UpdateTaskStatus)

		// Ticket endpoints
		api.POST("/tickets", handlers.CreateTicket)
		api.GET("/tickets", handlers.GetTickets)
		api.PATCH("/tickets/:id/status", handlers.UpdateTicketStatus)

		// Sub-task endpoints
		api.POST("/subtasks", handlers.CreateSubTask)
		api.GET("/subtasks", handlers.GetSubTasks)
		api.PATCH("/subtasks/:id/status", handlers.UpdateSubTaskStatus)

		// Team Collaboration & Comments endpoints
		api.POST("/comments", handlers.CreateComment)
		api.GET("/comments", handlers.GetComments)

		// Reports and Search endpoints
		api.GET("/search", handlers.GlobalSearch)
		api.GET("/reports/summary", handlers.GetSystemReport)

		// Protected Admin/Super Admin group
		adminGroup := api.Group("/")
		adminGroup.Use(middleware.AuthorizeRole("Super Admin", "Admin"))
		{
			adminGroup.POST("/projects", handlers.CreateProject)
			adminGroup.GET("/audit-logs", handlers.GetAuditLogs)
		}
	}
}
