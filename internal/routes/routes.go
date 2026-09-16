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

		// Client / Company profile endpoints. GET is open (needed for the
		// client picker when creating a project) — POST/PUT/DELETE are
		// gated in adminGroup below, since these are business-sensitive
		// records only Admin/Super Admin should be creating or editing.
		api.GET("/clients", handlers.GetClients)

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

		// Protected Admin / Super Admin routes. AuthenticateJWT MUST run
		// before AuthorizeRole — it's what verifies the token and sets
		// "userRole" on the context; AuthorizeRole only reads that
		// already-verified value, it doesn't verify anything itself.
		// Previously AuthorizeRole trusted a raw, client-settable
		// X-User-Role header directly, which meant anyone could grant
		// themselves Super Admin access on these routes with no
		// authentication at all.
		adminGroup := api.Group("/")
		adminGroup.Use(middleware.AuthenticateJWT())
		adminGroup.Use(middleware.AuthorizeRole("Super Admin", "Admin"))
		{
			adminGroup.POST("/projects", handlers.CreateProject)
			adminGroup.DELETE("/projects/:id", handlers.DeleteProject)
			adminGroup.GET("/audit-logs", handlers.GetAuditLogs)
			adminGroup.POST("/clients", handlers.CreateClient)
			adminGroup.PUT("/clients/:id", handlers.UpdateClient)
			adminGroup.DELETE("/clients/:id", handlers.DeleteClient)
		}
	}
}
