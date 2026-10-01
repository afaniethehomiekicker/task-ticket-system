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

	// NumericIDParams: every :id / :userId / :vendorId ... must be a plain
	// number. Handlers pass these straight to GORM's First(&row, id), which
	// treats a non-numeric string as raw SQL (see middleware/idparams.go).
	api := r.Group("/api", middleware.NumericIDParams())
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
			// 10 rejected logins from an IP in 15 minutes locks that IP out
			// for the rest of the window.
			loginLimit := middleware.LoginRateLimit(10, 15*time.Minute)
			// Captcha (see middleware/captcha.go): runs after the limiter so a
			// locked-out IP never costs a verify call. Off when no keys are set.
			captcha := middleware.RequireCaptcha()
			auth.GET("/captcha-config", middleware.CaptchaConfigHandler)
			// One login for every role. The separate /auth/admin-login
			// endpoint was removed: the frontend no longer uses it.
			auth.POST("/login", loginLimit, captcha, handlers.Login)
		}

		// All routes below require JWT authentication
		protected := api.Group("/")
		// RedactEmbeddedClients: clients embedded in any response are cut down
		// to reference fields for people not allowed the full record.
		protected.Use(middleware.AuthenticateJWT(), handlers.RedactEmbeddedClients())
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
				// Name-only search for client pickers (reference fields only).
				// Registered before "/:id" so "lookup" isn't read as an id.
				clients.GET("/lookup", handlers.LookupClients)
				// Admin-configurable extra client fields (spec slide 8).
				clients.GET("/fields", handlers.GetClientFields)
				clients.POST("/fields", middleware.RequirePermission("manage_clients"), handlers.CreateClientField)
				clients.PUT("/fields/:id", middleware.RequirePermission("manage_clients"), handlers.UpdateClientField)
				// Creating a client is also allowed for anyone who can raise a
				// feasibility (spec: "+ Add Client" inline, by staff). Editing
				// and archiving clients stay on manage_clients.
				clients.POST("", middleware.RequireAnyPermission("manage_clients", "create_feasibilities"), handlers.CreateClient)
				clients.GET("/:id", handlers.GetClient)
				// Client 360° view (spec slide 10).
				clients.GET("/:id/overview", handlers.GetClientOverview)
				clients.PUT("/:id", middleware.RequirePermission("manage_clients"), handlers.UpdateClient)
				clients.DELETE("/:id", middleware.RequirePermission("manage_clients"), handlers.DeleteClient)
				clients.PATCH("/:id/restore", middleware.RequirePermission("manage_clients"), handlers.RestoreClient)
				// Record-level access grants (spec slide 16).
				clients.GET("/:id/access", handlers.GetClientAccess)
				clients.POST("/:id/access", handlers.GrantClientAccess)
				clients.DELETE("/:id/access/:userId", handlers.RevokeClientAccess)
			}

			// Department endpoints. GET is open to any authenticated user —
			// every role's create/edit forms need this list to populate a
			// Department dropdown, same reasoning as GET /clients above.
			departments := protected.Group("/departments")
			{
				departments.GET("", handlers.GetDepartments)
				departments.POST("", middleware.RequirePermission("manage_departments"), handlers.CreateDepartment)
				departments.PUT("/:id", middleware.RequirePermission("manage_departments"), handlers.UpdateDepartment)
				departments.DELETE("/:id", middleware.RequirePermission("manage_departments"), handlers.ArchiveDepartment) // archives
				departments.PATCH("/:id/restore", middleware.RequirePermission("manage_departments"), handlers.RestoreDepartment)
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
				// Raising a feasibility request is its own permission (spec: staff
				// raise them); archive/restore/convert stay on create_projects.
				feasibilities.POST("", middleware.RequirePermission("create_feasibilities"), handlers.CreateFeasibility)
				feasibilities.PUT("/:id", handlers.UpdateFeasibility)
				feasibilities.DELETE("/:id", middleware.RequirePermission("create_projects"), handlers.DeleteFeasibility)
				feasibilities.PATCH("/:id/restore", middleware.RequirePermission("create_projects"), handlers.RestoreFeasibility)

				// Vendor management
				feasibilities.POST("/:id/vendors", handlers.AddFeasibilityVendor)
				feasibilities.PUT("/:id/vendors/:vendorId", handlers.UpdateFeasibilityVendor)
				feasibilities.DELETE("/:id/vendors/:vendorId", handlers.DeleteFeasibilityVendor) // withdraws
				feasibilities.PATCH("/:id/vendors/:vendorId/reinstate", handlers.ReinstateFeasibilityVendor)

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
				projects.PATCH("/:id/restore", handlers.RestoreProject)
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
				// GuardLinkedRecords: you can only link a project/client you can
				// see, and assigning on create follows the Assign rules
				// (see handlers/link_guard.go).
				tickets.POST("", handlers.GuardLinkedRecords(), handlers.CreateTicket)
				tickets.GET("/:id", handlers.GetTicket)
				tickets.PUT("/:id", handlers.GuardLinkedRecords(), handlers.UpdateTicket)
				tickets.DELETE("/:id", handlers.DeleteTicket)
				// Per-record history (spec slide 20 accountability chain).
				tickets.GET("/:id/timeline", handlers.GetTicketTimeline)
				// CNOC flow (spec slide 19): route on, return to origin, reopen.
				tickets.POST("/:id/route", handlers.RouteTicket)
				tickets.POST("/:id/return", handlers.ReturnTicket)
				tickets.POST("/:id/reopen", handlers.ReopenTicket)
				tickets.PATCH("/:id/restore", handlers.RestoreTicket)
				tickets.PATCH("/:id/status", handlers.UpdateTicketStatus)
				// Was ungated — same issue as CreateTask above.
				// canAssignTickets() in permissions.js checks the matrix
				// client-side; nothing enforced it server-side.
				// Checked in the handler: assign_tickets, OR the current assignee
				// transferring within their department (transfer_assigned_work).
				tickets.POST("/:id/assign", handlers.AssignTicket)
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
			// Configurable status catalog (spec slide 21). Everyone reads it; only
			// the Super Admin changes it (slide 5: Super Admin configures the system).
			workflow := protected.Group("/workflow")
			{
				workflow.GET("/statuses", handlers.GetWorkflowStatuses)
				workflow.POST("/statuses", middleware.RequireRole("super_admin"), handlers.CreateWorkflowStatus)
				workflow.PUT("/statuses/:id", middleware.RequireRole("super_admin"), handlers.UpdateWorkflowStatus)
				// Configurable SLA per priority (spec slide 22).
				workflow.GET("/sla", handlers.GetSLAPolicies)
				workflow.PUT("/sla/:id", middleware.RequireRole("super_admin"), handlers.UpdateSLAPolicy)
			}

			// Server-side notifications (spec slide 27).
			// Per-person pins (spec slide 28).
			// Documents & evidence (spec slides 25, 27) — access-checked downloads.
			protected.GET("/documents", handlers.ListDocuments)
			protected.POST("/documents", handlers.UploadDocument)
			protected.GET("/documents/:id/download", handlers.DownloadDocument)
			protected.DELETE("/documents/:id", handlers.ArchiveDocument)
			protected.GET("/pins", handlers.GetPins)
			protected.PUT("/pins/:type/:id", handlers.AddPin)
			protected.DELETE("/pins/:type/:id", handlers.RemovePin)
			protected.GET("/notifications", handlers.GetNotifications)
			protected.PATCH("/notifications/:id/read", handlers.MarkNotificationRead)
			protected.POST("/notifications/read-all", handlers.MarkAllNotificationsRead)

			// Vendor master (spec slides 30-31). Everyone reads it (feasibility
			// vendor pickers); changes need "Manage Vendor List".
			vendors := protected.Group("/vendors")
			{
				vendors.GET("", handlers.GetVendors)
				vendors.GET("/:id", handlers.GetVendor)
				vendors.POST("", middleware.RequirePermission("manage_vendors"), handlers.CreateVendor)
				vendors.PUT("/:id", middleware.RequirePermission("manage_vendors"), handlers.UpdateVendor)
				vendors.DELETE("/:id", middleware.RequirePermission("manage_vendors"), handlers.ArchiveVendor) // archives
				vendors.PATCH("/:id/restore", middleware.RequirePermission("manage_vendors"), handlers.RestoreVendor)
			}

			tasks := protected.Group("/tasks")
			{
				tasks.GET("", handlers.GetTasks)
				// Was ungated — permissions.js's canCreateTask() checks the
				// matrix client-side and hides the button accordingly, but
				// nothing stopped anyone with a valid token from calling
				// this directly regardless of their actual permission.
				tasks.POST("", middleware.RequirePermission("create_tasks"), handlers.GuardLinkedRecords(), handlers.CreateTask)
				tasks.GET("/:id", handlers.GetTask)
				tasks.PUT("/:id", handlers.UpdateTask)
				tasks.DELETE("/:id", handlers.DeleteTask)
				tasks.PATCH("/:id/restore", handlers.RestoreTask)
				// Record-level access grants (spec slide 16).
				tasks.GET("/:id/timeline", handlers.GetTaskTimeline)
				tasks.GET("/:id/access", handlers.GetTaskAccess)
				tasks.POST("/:id/access", handlers.GrantTaskAccess)
				tasks.DELETE("/:id/access/:userId", handlers.RevokeTaskAccess)
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
			// ScopeUserManagement: department admins manage only their own
			// department's users (see middleware/user_scope.go).
			users.Use(middleware.RequirePermission("manage_users"), middleware.ScopeUserManagement())
			{
				users.GET("", handlers.GetUsers)
				users.POST("", handlers.AdminCreateUser)
				users.GET("/:id", handlers.GetUser)
				users.PUT("/:id", handlers.AdminUpdateUser)
				users.DELETE("/:id", handlers.ArchiveUser) // archives — nothing is hard-deleted (spec slide 29)
				users.PATCH("/:id/restore", handlers.RestoreUser)
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
