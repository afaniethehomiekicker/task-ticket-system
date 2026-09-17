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
		// Dedicated Super Admin portal login — same credential check as
		// /auth/login, with an added role gate. See AdminLogin in auth.go
		// for why it deliberately returns the same generic error for a
		// wrong password AND for a correct password on a non-super-admin
		// account.
		api.POST("/auth/admin-login", handlers.AdminLogin)

		// File Upload endpoint
		api.POST("/upload", handlers.UploadAvatar)

		// User management endpoints
		api.GET("/users", handlers.GetUsers)
		// AuthenticateJWT only, deliberately no AuthorizeRole — self-edit
		// must work for ANY authenticated user, not just admins. The
		// handler itself reads the verified caller identity/role off the
		// context and decides which fields are actually allowed to
		// change, rather than gating the whole route to one tier.
		api.PUT("/users/:id", middleware.AuthenticateJWT(), handlers.UpdateUserProfile)

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
		// Review workflow. Submit requires only AuthenticateJWT — the
		// handler itself checks "is this the assignee" since that's not
		// a fixed role AuthorizeRole could express. Approve/reopen are
		// restricted to Supervisor/Admin (Super Admin bypasses via
		// AuthorizeRole's existing rule) — a task's own assignee cannot
		// approve their own work, enforced server-side now, not just by
		// which buttons the frontend renders.
		api.PATCH("/tasks/:id/submit-review", middleware.AuthenticateJWT(), handlers.SubmitTaskForReview)
		api.PATCH("/tasks/:id/approve", middleware.AuthenticateJWT(), middleware.AuthorizeRole("Admin", "Supervisor"), handlers.ApproveTask)
		api.PATCH("/tasks/:id/reopen", middleware.AuthenticateJWT(), middleware.AuthorizeRole("Admin", "Supervisor"), handlers.ReopenTask)
		api.POST("/tasks/:id/dependencies", handlers.AddTaskDependency)
		api.DELETE("/tasks/:id/dependencies/:depId", handlers.RemoveTaskDependency)

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

		// Checklist endpoints (checklist items live under a task). Any
		// authenticated user can add/toggle — no finer-grained role
		// restriction exists in the current UI for these, unlike the
		// review-workflow actions.
		api.POST("/checklists", middleware.AuthenticateJWT(), handlers.CreateChecklistItem)
		api.PATCH("/checklists/:id/toggle", middleware.AuthenticateJWT(), handlers.ToggleChecklistItem)

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
			adminGroup.POST("/users", handlers.AdminCreateUser)
			adminGroup.DELETE("/users/:id", handlers.DeleteUser)
		}
	}
}
