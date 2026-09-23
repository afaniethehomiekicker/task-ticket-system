package routes

import (
	"os"
	"time"

	"task-ticket-backend/internal/handlers"
	"task-ticket-backend/internal/middleware"

	"github.com/gin-gonic/gin"
)

func RegisterRoutes(r *gin.Engine) {
	// Serve static uploads
	r.Static("/uploads", "./uploads")

	api := r.Group("/api")
	{
		// Health check
		api.GET("/health", func(c *gin.Context) {
			c.JSON(200, gin.H{"status": "backend is running smoothly"})
		})

		// Auth endpoints (public)
		auth := api.Group("/auth")
		{
			// Open self-registration is OFF unless explicitly enabled. Register
			// creates an ACTIVE account in whatever department the caller names,
			// which (combined with department-scoped visibility) let anyone who
			// can reach the API grant themselves access to a department's data.
			// The spec is an internal-only system; admins create accounts via
			// POST /api/users.
			if os.Getenv("ALLOW_PUBLIC_REGISTRATION") == "true" {
				auth.POST("/register", handlers.Register)
			}
			// One limiter shared by both login routes: 10 rejected logins from
			// an IP in 15 minutes locks that IP out for the rest of the window.
			loginLimit := middleware.LoginRateLimit(10, 15*time.Minute)
			auth.POST("/login", loginLimit, handlers.Login)
			auth.POST("/admin-login", loginLimit, handlers.AdminLogin)
		}

		// All routes below require JWT authentication
		protected := api.Group("/")
		protected.Use(middleware.AuthenticateJWT())
		{
			// User profile
			protected.GET("/me", handlers.GetCurrentUser)
			protected.PUT("/me", handlers.UpdateCurrentUser)
			protected.PUT("/me/password", handlers.ChangePassword)

			// Avatar upload (files are served from /uploads, registered above)
			protected.POST("/upload", handlers.UploadAvatar)

			// People directory — available without manage_users (see directory.go)
			protected.GET("/directory/users", handlers.GetUserDirectory)

			// Role & Permission Matrix
			roles := protected.Group("/roles")
			{
				roles.GET("", handlers.GetRoles)
				roles.GET("/permissions", handlers.GetPermissionMatrix)
				roles.POST("", middleware.RequirePermission("manage_matrix_permissions"), handlers.CreateRole)
				roles.PUT("/:key", middleware.RequirePermission("manage_matrix_permissions"), handlers.UpdateRole)
				roles.DELETE("/:key", middleware.RequirePermission("manage_matrix_permissions"), handlers.DeleteRole)
				roles.PUT("/:key/permissions/:permissionKey", middleware.RequirePermission("manage_matrix_permissions"), handlers.SetPermission)
			}

			// Client endpoints
			clients := protected.Group("/clients")
			{
				clients.GET("", handlers.GetClients)
				clients.POST("", middleware.RequirePermission("manage_clients"), handlers.CreateClient)
				clients.GET("/:id", handlers.GetClient)
				clients.PUT("/:id", middleware.RequirePermission("manage_clients"), handlers.UpdateClient)
				clients.DELETE("/:id", middleware.RequirePermission("manage_clients"), handlers.DeleteClient)
			}

			// Department endpoints. GET is open to any authenticated user —
			// every role's create/edit forms need this list to populate a
			// Department dropdown, same reasoning as GET /clients above.
			departments := protected.Group("/departments")
			{
				departments.GET("", handlers.GetDepartments)
				departments.POST("", middleware.RequirePermission("manage_departments"), handlers.CreateDepartment)
				departments.PUT("/:id", middleware.RequirePermission("manage_departments"), handlers.UpdateDepartment)
				departments.DELETE("/:id", middleware.RequirePermission("manage_departments"), handlers.DeleteDepartment)
			}

			// Feasibility endpoints
			feasibilities := protected.Group("/feasibilities")
			{
				// Public read access (for dropdowns/pickers)
				feasibilities.GET("", handlers.GetFeasibilities)
				feasibilities.GET("/products", handlers.GetFeasibilityProducts)
				feasibilities.GET("/vendor-statuses", handlers.GetFeasibilityVendorStatuses)
				feasibilities.GET("/statuses", handlers.GetFeasibilityStatuses)
				feasibilities.GET("/:id", handlers.GetFeasibility)

				// Mutations require create_projects permission
				feasibilities.POST("", middleware.RequirePermission("create_projects"), handlers.CreateFeasibility)
				feasibilities.PUT("/:id", handlers.UpdateFeasibility)
				feasibilities.DELETE("/:id", middleware.RequirePermission("create_projects"), handlers.DeleteFeasibility)

				// Vendor management
				feasibilities.POST("/:id/vendors", handlers.AddFeasibilityVendor)
				feasibilities.PUT("/:id/vendors/:vendorId", handlers.UpdateFeasibilityVendor)
				feasibilities.DELETE("/:id/vendors/:vendorId", handlers.DeleteFeasibilityVendor)

				// Conversion to Project
				feasibilities.POST("/:id/convert", middleware.RequirePermission("create_projects"), handlers.ConvertFeasibilityToProject)
			}

			// Project endpoints
			projects := protected.Group("/projects")
			{
				projects.GET("", handlers.GetProjects)
				projects.POST("", middleware.RequirePermission("create_projects"), handlers.CreateProject)
				projects.GET("/:id", handlers.GetProject)
				projects.PUT("/:id", handlers.UpdateProject)
				projects.DELETE("/:id", handlers.DeleteProject)
				projects.GET("/:id/stats", handlers.GetProjectStats)

				// Project members
				projects.POST("/:id/members", handlers.AddProjectMember)
				projects.DELETE("/:id/members/:userId", handlers.RemoveProjectMember)

				// Project tasks
				projects.GET("/:id/tasks", handlers.GetProjectTasks)
				projects.GET("/:id/tickets", handlers.GetProjectTickets)
			}

			// Ticket endpoints
			tickets := protected.Group("/tickets")
			{
				tickets.GET("", handlers.GetTickets)
				tickets.POST("", handlers.CreateTicket)
				tickets.GET("/:id", handlers.GetTicket)
				tickets.PUT("/:id", handlers.UpdateTicket)
				tickets.DELETE("/:id", handlers.DeleteTicket)
				tickets.PATCH("/:id/status", handlers.UpdateTicketStatus)
				// Was ungated — same issue as CreateTask above.
				// canAssignTickets() in permissions.js checks the matrix
				// client-side; nothing enforced it server-side.
				tickets.POST("/:id/assign", middleware.RequirePermission("assign_tickets"), handlers.AssignTicket)
				tickets.PATCH("/:id/escalate", handlers.EscalateTicket)

				// Ticket comments
				tickets.GET("/:id/comments", handlers.GetTicketComments)
				tickets.POST("/:id/comments", handlers.AddTicketComment)

				// Ticket work logs
				tickets.GET("/:id/work-logs", handlers.GetTicketWorkLogs)
				tickets.POST("/:id/work-logs", handlers.AddTicketWorkLog)

				// Ticket tasks
				tickets.GET("/:id/tasks", handlers.GetTicketTasks)
			}

			// Task endpoints
			tasks := protected.Group("/tasks")
			{
				tasks.GET("", handlers.GetTasks)
				// Was ungated — permissions.js's canCreateTask() checks the
				// matrix client-side and hides the button accordingly, but
				// nothing stopped anyone with a valid token from calling
				// this directly regardless of their actual permission.
				tasks.POST("", middleware.RequirePermission("create_tasks"), handlers.CreateTask)
				tasks.GET("/:id", handlers.GetTask)
				tasks.PUT("/:id", handlers.UpdateTask)
				tasks.DELETE("/:id", handlers.DeleteTask)
				tasks.PATCH("/:id/status", handlers.UpdateTaskStatus)

				// Review workflow: todo/in_progress -> in_review -> done
				// (reopen returns it to in_progress). See task_workflow.go.
				tasks.PATCH("/:id/submit-review", handlers.SubmitTaskForReview)
				tasks.PATCH("/:id/approve", handlers.ApproveTask)
				tasks.PATCH("/:id/reopen", handlers.ReopenTask)

				// Subtasks
				tasks.GET("/:id/subtasks", handlers.GetSubTasks)
				tasks.POST("/:id/subtasks", handlers.CreateSubTask)
				tasks.PUT("/subtasks/:subtaskId", handlers.UpdateSubTask)
				tasks.PATCH("/subtasks/:subtaskId/status", handlers.UpdateSubTaskStatus)
				tasks.DELETE("/subtasks/:subtaskId", handlers.DeleteSubTask)

				// Task dependencies
				tasks.POST("/:id/dependencies", handlers.AddTaskDependency)
				tasks.DELETE("/:id/dependencies/:depId", handlers.RemoveTaskDependency)

				// Task comments
				tasks.GET("/:id/comments", handlers.GetTaskComments)
				tasks.POST("/:id/comments", handlers.AddTaskComment)

				// Task work logs
				tasks.GET("/:id/work-logs", handlers.GetTaskWorkLogs)
				tasks.POST("/:id/work-logs", handlers.AddTaskWorkLog)
			}

			// Task checklist items (flat routes — the frontend calls
			// /api/checklists and /api/checklists/:id/toggle)
			checklists := protected.Group("/checklists")
			{
				checklists.POST("", handlers.CreateChecklistItem)
				checklists.PATCH("/:id/toggle", handlers.ToggleChecklistItem)
			}

			// User management (admin only)
			users := protected.Group("/users")
			users.Use(middleware.RequirePermission("manage_users"))
			{
				users.GET("", handlers.GetUsers)
				users.POST("", handlers.AdminCreateUser)
				users.GET("/:id", handlers.GetUser)
				users.PUT("/:id", handlers.AdminUpdateUser)
				users.DELETE("/:id", handlers.AdminDeleteUser)
				users.PATCH("/:id/status", handlers.ToggleUserStatus)
				users.PUT("/:id/role", handlers.UpdateUserRole)
			}

			// Audit logs (admin/super_admin)
			audit := protected.Group("/audit")
			audit.Use(middleware.RequirePermission("view_audit_logs"))
			{
				audit.GET("", handlers.GetAuditLogs)
				audit.GET("/:id", handlers.GetAuditLog)
			}

			// Reports & Dashboard
			reports := protected.Group("/reports")
			{
				reports.GET("/dashboard", handlers.GetDashboardStats)
				reports.GET("/tickets-by-status", handlers.GetTicketsByStatus)
				reports.GET("/tasks-by-status", handlers.GetTasksByStatus)
				reports.GET("/workload", handlers.GetWorkloadReport)
				reports.GET("/sla-breaches", handlers.GetSLABreaches)
			}

			// Search
			protected.GET("/search", handlers.GlobalSearch)
		}
	}
}
