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
		// gated below by the "manage_clients" permission, dynamically
		// checked against the persisted matrix rather than a hardcoded
		// role list.
		api.GET("/clients", handlers.GetClients)

		// Role & Permission Matrix endpoints. GET is open — role names
		// aren't sensitive, and a role picker (e.g. creating a user)
		// needs this list regardless of who's asking. Mutations require
		// the "manage_matrix_permissions" capability — checked dynamically,
		// same as everything else below, so a Super Admin can delegate
		// JUST this power to a custom role without it also inheriting
		// everything else Admin can do.
		api.GET("/roles", handlers.GetRoles)
		api.GET("/permissions", handlers.GetPermissionMatrix)
		api.POST("/roles", middleware.AuthenticateJWT(), middleware.RequirePermission("manage_matrix_permissions"), handlers.CreateRole)
		api.PUT("/roles/:key", middleware.AuthenticateJWT(), middleware.RequirePermission("manage_matrix_permissions"), handlers.UpdateRole)
		api.DELETE("/roles/:key", middleware.AuthenticateJWT(), middleware.RequirePermission("manage_matrix_permissions"), handlers.DeleteRole)
		api.PUT("/permissions/:roleKey/:permissionKey", middleware.AuthenticateJWT(), middleware.RequirePermission("manage_matrix_permissions"), handlers.SetPermission)

		// Project endpoints
		// GET /projects and GET /tasks now require AuthenticateJWT —
		// neither had ANY auth requirement before. Both handlers read
		// the verified caller identity/role to restrict what a "staff"
		// caller receives (see GetProjects/GetTasks for the specifics).
		api.GET("/projects", middleware.AuthenticateJWT(), handlers.GetProjects)
		api.PUT("/projects/:id", handlers.UpdateProject)

		// Task endpoints. Creation now requires the "create_tasks"
		// capability — previously this route had NO restriction at all,
		// open to any authenticated-or-not caller.
		api.GET("/tasks", middleware.AuthenticateJWT(), handlers.GetTasks)
		api.POST("/tasks", middleware.AuthenticateJWT(), middleware.RequirePermission("create_tasks"), handlers.CreateTask)
		api.PUT("/tasks/:id", handlers.UpdateTask)
		api.PATCH("/tasks/:id/status", handlers.UpdateTaskStatus)
		api.DELETE("/tasks/:id", handlers.DeleteTask)
		// Review workflow. Submit requires only AuthenticateJWT — the
		// handler itself checks "is this the assignee" since that's not
		// a fixed capability RequirePermission could express on its own.
		// Approve/reopen now check the dynamic "approve_work"
		// capability instead of a hardcoded Admin/Supervisor list — a
		// task's own assignee still cannot approve their own work
		// (that's enforced separately, in ApproveTask itself via the
		// AssigneeID check), but WHO counts as an approver at all is now
		// configurable from the Settings & Matrix page.
		api.PATCH("/tasks/:id/submit-review", middleware.AuthenticateJWT(), handlers.SubmitTaskForReview)
		api.PATCH("/tasks/:id/approve", middleware.AuthenticateJWT(), middleware.RequirePermission("approve_work"), handlers.ApproveTask)
		api.PATCH("/tasks/:id/reopen", middleware.AuthenticateJWT(), middleware.RequirePermission("approve_work"), handlers.ReopenTask)
		api.POST("/tasks/:id/dependencies", handlers.AddTaskDependency)
		api.DELETE("/tasks/:id/dependencies/:depId", handlers.RemoveTaskDependency)

		// Ticket endpoints. Escalation now requires "escalate_tickets" —
		// previously this route also had NO restriction at all.
		api.GET("/tickets", handlers.GetTickets)
		api.POST("/tickets", handlers.CreateTicket)
		api.PUT("/tickets/:id", handlers.UpdateTicket)
		api.PATCH("/tickets/:id/status", handlers.UpdateTicketStatus)
		api.PATCH("/tickets/:id/escalate", middleware.AuthenticateJWT(), middleware.RequirePermission("escalate_tickets"), handlers.EscalateTicket)
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

		// Dynamic-permission-gated routes. Each checks the persisted
		// matrix (see internal/middleware/permissions.go) instead of a
		// hardcoded role list — this is what actually makes a custom
		// role like "Quality Assurance" able to do anything at all: a
		// Super Admin can grant it exactly these capabilities from the
		// Settings & Matrix page, no code change required.
		api.POST("/projects", middleware.AuthenticateJWT(), middleware.RequirePermission("create_projects"), handlers.CreateProject)
		api.POST("/clients", middleware.AuthenticateJWT(), middleware.RequirePermission("manage_clients"), handlers.CreateClient)
		api.PUT("/clients/:id", middleware.AuthenticateJWT(), middleware.RequirePermission("manage_clients"), handlers.UpdateClient)
		api.DELETE("/clients/:id", middleware.AuthenticateJWT(), middleware.RequirePermission("manage_clients"), handlers.DeleteClient)
		api.POST("/users", middleware.AuthenticateJWT(), middleware.RequirePermission("manage_users"), handlers.AdminCreateUser)
		api.DELETE("/users/:id", middleware.AuthenticateJWT(), middleware.RequirePermission("manage_users"), handlers.DeleteUser)
		api.GET("/audit-logs", middleware.AuthenticateJWT(), middleware.RequirePermission("view_audit_logs"), handlers.GetAuditLogs)

		// Protected Admin / Super Admin routes still on the static
		// AuthorizeRole pattern — DeleteProject doesn't have its own
		// matrix row yet (the visible matrix only shows "Create & Edit
		// Projects" as one capability); bundling delete under
		// create_projects felt like a bigger assumption to make silently
		// than leaving this one route as-is for now. Splitting it into
		// its own "delete_projects" permission key is a small, separate
		// follow-up whenever that granularity is actually wanted.
		adminGroup := api.Group("/")
		adminGroup.Use(middleware.AuthenticateJWT())
		adminGroup.Use(middleware.AuthorizeRole("Super Admin", "Admin"))
		{
			adminGroup.DELETE("/projects/:id", handlers.DeleteProject)
		}
	}
}
