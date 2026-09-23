package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type CreateProjectInput struct {
	Code          string     `json:"code"` // optional — auto-generated (PRJ-000001 style) if omitted
	Title         string     `json:"title" binding:"required"`
	Description   string     `json:"description"`
	Type          string     `json:"type"`       // general, ticketing
	Department    string     `json:"department"` // owning department
	Status        string     `json:"status"`
	Priority      string     `json:"priority"`
	StartDate     *time.Time `json:"start_date"`
	DueDate       *time.Time `json:"due_date"`
	ClientID      *uint      `json:"client_id"`
	OwnerID       *uint      `json:"owner_id"`
	AdminID       *uint      `json:"admin_id"`
	BudgetHours   float64    `json:"budget_hours"`
	MemberIDs     []uint     `json:"member_ids"`
	SupervisorIDs []uint     `json:"supervisor_ids"`
}

type UpdateProjectInput struct {
	Title         string     `json:"title"`
	Description   string     `json:"description"`
	Type          string     `json:"type"`
	Department    string     `json:"department"`
	Status        string     `json:"status"`
	Priority      string     `json:"priority"`
	StartDate     *time.Time `json:"start_date"`
	DueDate       *time.Time `json:"due_date"`
	ClientID      *uint      `json:"client_id"`
	OwnerID       *uint      `json:"owner_id"`
	AdminID       *uint      `json:"admin_id"`
	BudgetHours   float64    `json:"budget_hours"`
	Progress      *int       `json:"progress"` // pointer: "not sent" must not mean "0"
	MemberIDs     []uint     `json:"member_ids"`
	SupervisorIDs []uint     `json:"supervisor_ids"`
}

type ProjectQueryParams struct {
	Type       string `form:"type"`
	Status     string `form:"status"`
	Department string `form:"department"`
	ClientID   string `form:"client_id"`
	OwnerID    string `form:"owner_id"`
	Search     string `form:"search"`
	Page       int    `form:"page,default=1"`
	Limit      int    `form:"limit,default=20"`
	SortBy     string `form:"sort_by,default=created_at"`
	SortOrder  string `form:"sort_order,default=desc"`
}

// Sortable columns for GET /api/projects (whitelist — see safeOrderClause).
var projectSortColumns = map[string]string{
	"created_at": "projects.created_at",
	"updated_at": "projects.updated_at",
	"start_date": "projects.start_date",
	"due_date":   "projects.due_date",
	"priority":   "projects.priority",
	"status":     "projects.status",
	"title":      "projects.title",
	"code":       "projects.code",
	"progress":   "projects.progress",
}

// Statuses UpdateProject/CreateProject accept. "archived" is deliberately
// absent: only DeleteProject (admin-only, stamps who/when) can set it.
func validProjectStatus(s string) bool {
	switch s {
	case "planning", "active", "on_hold", "completed", "cancelled":
		return true
	}
	return false
}

// GetProjects returns paginated projects
func GetProjects(c *gin.Context) {
	var params ProjectQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	params.Page, params.Limit = clampPagination(params.Page, params.Limit)

	userRoleVal, _ := c.Get("user_role")
	currentUserRole := userRoleVal.(string)

	query := database.DB.
		Preload("Client").
		Preload("Owner").
		Preload("Admin").
		Preload("Members").
		Preload("Supervisors").
		Order(safeOrderClause(params.SortBy, params.SortOrder, projectSortColumns, "projects.created_at"))

	// Visibility (see visibility.go): admins their department's (and owned)
	// projects, everyone else the projects they're a member of.
	query = applyProjectScope(query, viewerFrom(c))

	if params.Type != "" {
		query = query.Where("type = ?", params.Type)
	}
	if params.Status != "" {
		query = query.Where("status = ?", params.Status)
	} else {
		// No status filter given = the default, day-to-day list. Now
		// that "delete" means "archived" rather than a real DeletedAt,
		// archived projects would otherwise show up mixed into this
		// list — they're still fully reachable via
		// GET /projects?status=archived or GET /projects/:id directly.
		query = query.Where("status != ?", "archived")
	}
	if params.Department != "" && (currentUserRole == "super_admin" || currentUserRole == "admin") {
		query = query.Where("department = ?", params.Department)
	}
	if params.ClientID != "" {
		query = query.Where("client_id = ?", params.ClientID)
	}
	if params.OwnerID != "" {
		query = query.Where("owner_id = ?", params.OwnerID)
	}
	if params.Search != "" {
		searchTerm := "%" + strings.ToLower(params.Search) + "%"
		query = query.Where(
			"LOWER(code) LIKE ? OR LOWER(title) LIKE ? OR LOWER(description) LIKE ?",
			searchTerm, searchTerm, searchTerm,
		)
	}

	var total int64
	query.Model(&models.Project{}).Count(&total)

	offset := (params.Page - 1) * params.Limit
	query = query.Offset(offset).Limit(params.Limit)

	var projects []models.Project
	if err := query.Find(&projects).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch projects"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"projects": projects,
		"pagination": gin.H{
			"page":  params.Page,
			"limit": params.Limit,
			"total": total,
			"pages": (total + int64(params.Limit) - 1) / int64(params.Limit),
		},
	})
}

// GetProject returns a single project by ID
func GetProject(c *gin.Context) {
	id := c.Param("id")

	v := viewerFrom(c)

	// The project's tasks and tickets are filtered to what THIS caller may
	// see. They used to be preloaded unfiltered, so opening a project you could
	// see handed you every task and ticket in it.
	query := database.DB.
		Preload("Client").
		Preload("Owner").
		Preload("Admin").
		Preload("Members").
		Preload("Supervisors").
		Preload("Tasks", func(db *gorm.DB) *gorm.DB { return applyTaskScope(db, v) }).
		Preload("Tasks.Assignee").
		Preload("Tickets", func(db *gorm.DB) *gorm.DB { return applyTicketScope(db, v) }).
		Preload("Tickets.AssignedTo")

	var project models.Project
	if err := query.First(&project, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch project"})
		return
	}

	// Privacy check (see visibility.go)
	if !userCanAccessProject(c, &project) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"project": project})
}

// CreateProject creates a new project
func CreateProject(c *gin.Context) {
	var input CreateProjectInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userIDVal, _ := c.Get("user_id")
	currentUserID := userIDVal.(uint)
	userDeptVal, _ := c.Get("user_department")
	currentUserDept := userDeptVal.(string)

	// Auto-generate Code server-side, matching Task/Ticket/Client/
	// Feasibility's numbering pattern — Project was the one entity still
	// requiring the CALLER to invent a unique code. That mattered in
	// practice: the frontend was generating it as
	// `PRJ-${Date.now().toString().slice(-4)}`, the last 4 digits of a
	// millisecond timestamp, which repeats every 10 seconds. Two people
	// creating projects within the same 10-second window — routine
	// usage, not a rare race condition — would collide on the unique
	// index and one creation would fail outright. A caller-supplied Code
	// is still honored if explicitly provided (e.g. for a deliberate
	// naming scheme); it's only auto-generated when omitted.
	code := input.Code
	if code == "" {
		var maxNum int
		database.DB.Unscoped().Model(&models.Project{}).
			Where("code ~ '^PRJ-[0-9]+$'").
			Select("COALESCE(MAX(CAST(SUBSTRING(code FROM 5) AS INTEGER)), 0)").
			Scan(&maxNum)
		code = fmt.Sprintf("PRJ-%06d", maxNum+1)
	}

	// Validate unique code (only meaningful now for an explicitly-
	// supplied code — an auto-generated one is unique by construction).
	var existing models.Project
	if err := database.DB.Where("code = ?", code).First(&existing).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Project code already exists"})
		return
	}

	// Validate client if provided
	if input.ClientID != nil {
		var client models.Client
		if err := database.DB.First(&client, *input.ClientID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Client not found"})
			return
		}
	}

	// Validate owner
	if input.OwnerID != nil {
		var owner models.User
		if err := database.DB.First(&owner, *input.OwnerID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Owner not found"})
			return
		}
	}

	// Validate admin
	if input.AdminID != nil {
		var admin models.User
		if err := database.DB.First(&admin, *input.AdminID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Admin not found"})
			return
		}
	}

	// Department defaults to user's department
	department := input.Department
	if department == "" {
		department = currentUserDept
	}
	// A department admin creates projects for their own department. (Super
	// admins and department-less system admins can create in any.) Without this
	// they could create a project they then couldn't see.
	if v := viewerFrom(c); v.isDeptAdmin() && !sameDept(v.Dept, department) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only create projects in your own department"})
		return
	}
	// The creator owns the project unless someone else is named — ownership is
	// part of what lets an admin see it (visibility.go).
	if input.OwnerID == nil {
		input.OwnerID = &currentUserID
	}

	// Type defaults to general
	projectType := input.Type
	if projectType == "" {
		projectType = "general"
	}
	if projectType != "general" && projectType != "ticketing" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project type. Must be 'general' or 'ticketing'"})
		return
	}

	project := models.Project{
		Code:        code,
		Title:       input.Title,
		Description: input.Description,
		Type:        models.ProjectType(projectType),
		Department:  department,
		Status:      input.Status,
		Priority:    input.Priority,
		StartDate:   input.StartDate,
		DueDate:     input.DueDate,
		ClientID:    input.ClientID,
		OwnerID:     input.OwnerID,
		AdminID:     input.AdminID,
		BudgetHours: input.BudgetHours,
		Progress:    0,
	}

	if project.Status == "" {
		project.Status = "planning"
	}
	if !validProjectStatus(project.Status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project status"})
		return
	}
	if project.Priority == "" {
		project.Priority = "normal"
	}

	if err := database.DB.Create(&project).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create project: " + err.Error()})
		return
	}

	// Add members
	if len(input.MemberIDs) > 0 {
		var members []models.User
		database.DB.Where("id IN ?", input.MemberIDs).Find(&members)
		database.DB.Model(&project).Association("Members").Append(&members)
	}

	// Add supervisors
	if len(input.SupervisorIDs) > 0 {
		var supervisors []models.User
		database.DB.Where("id IN ?", input.SupervisorIDs).Find(&supervisors)
		database.DB.Model(&project).Association("Supervisors").Append(&supervisors)
	}

	utils.LogAudit(currentUserID, "created", "project", project.ID,
		fmt.Sprintf("Created project %s: %s", project.Code, project.Title), c.ClientIP(), c.Request.UserAgent())

	// Reload
	database.DB.
		Preload("Client").
		Preload("Owner").
		Preload("Admin").
		Preload("Members").
		Preload("Supervisors").
		First(&project, project.ID)

	c.JSON(http.StatusCreated, gin.H{"message": "Project created successfully", "project": project})
}

// UpdateProject updates an existing project
func UpdateProject(c *gin.Context) {
	id := c.Param("id")

	userIDVal, _ := c.Get("user_id")
	userRoleVal, _ := c.Get("user_role")
	currentUserID := userIDVal.(uint)
	currentUserRole := userRoleVal.(string)

	var project models.Project
	if err := database.DB.First(&project, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch project"})
		return
	}

	// Privacy check (see visibility.go)
	if !userCanAccessProject(c, &project) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	// Editing a project is the "Create & Edit Projects" permission. PUT had no
	// permission check at all, so anyone who could see a project — staff
	// included — could rename it, change its status, replace its members or
	// take it over.
	if !canEditProjects(currentUserRole) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to edit projects"})
		return
	}

	var input UpdateProjectInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if input.Title != "" {
		updates["title"] = input.Title
	}
	if input.Description != "" {
		updates["description"] = input.Description
	}
	if input.Type != "" {
		if input.Type != "general" && input.Type != "ticketing" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project type"})
			return
		}
		updates["type"] = input.Type
	}
	// Moving a project between departments is a system-level action.
	if input.Department != "" && viewerFrom(c).seesEverything() {
		updates["department"] = input.Department
	}
	if input.Status != "" && input.Status != project.Status {
		// "archived" used to be accepted here, which let anyone who could edit
		// a project bypass DeleteProject's admin-only gate; any other string
		// was accepted too.
		if input.Status == "archived" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Use the archive/delete action to archive a project"})
			return
		}
		if !validProjectStatus(input.Status) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project status"})
			return
		}
		updates["status"] = input.Status
		if input.Status == "completed" && project.CompletedAt == nil {
			now := time.Now()
			updates["completed_at"] = now
		}
	}
	if input.Priority != "" {
		updates["priority"] = input.Priority
	}
	if input.StartDate != nil {
		updates["start_date"] = *input.StartDate
	}
	if input.DueDate != nil {
		updates["due_date"] = *input.DueDate
	}
	if input.ClientID != nil {
		// Verify client exists
		var client models.Client
		if err := database.DB.First(&client, *input.ClientID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Client not found"})
			return
		}
		updates["client_id"] = *input.ClientID
	}
	if input.OwnerID != nil {
		var owner models.User
		if err := database.DB.First(&owner, *input.OwnerID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Owner not found"})
			return
		}
		updates["owner_id"] = *input.OwnerID
	}
	if input.AdminID != nil {
		var admin models.User
		if err := database.DB.First(&admin, *input.AdminID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Admin not found"})
			return
		}
		updates["admin_id"] = *input.AdminID
	}
	if input.BudgetHours > 0 {
		updates["budget_hours"] = input.BudgetHours
	}
	// Progress was a plain int with an "is it within 0-100" check, which an
	// omitted field (0) always passed — so EVERY update, even just renaming
	// the project, silently reset its progress to 0.
	if input.Progress != nil {
		if *input.Progress < 0 || *input.Progress > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Progress must be between 0 and 100"})
			return
		}
		updates["progress"] = *input.Progress
	}

	if len(updates) > 0 {
		if err := database.DB.Model(&project).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update project"})
			return
		}
	}

	// Update members if provided
	if len(input.MemberIDs) > 0 {
		var members []models.User
		database.DB.Where("id IN ?", input.MemberIDs).Find(&members)
		database.DB.Model(&project).Association("Members").Replace(&members)
	}

	// Update supervisors if provided
	if len(input.SupervisorIDs) > 0 {
		var supervisors []models.User
		database.DB.Where("id IN ?", input.SupervisorIDs).Find(&supervisors)
		database.DB.Model(&project).Association("Supervisors").Replace(&supervisors)
	}

	database.DB.First(&project, id)

	utils.LogAudit(currentUserID, "updated", "project", project.ID,
		fmt.Sprintf("Updated project %s", project.Code), c.ClientIP(), c.Request.UserAgent())

	// Reload
	database.DB.
		Preload("Client").
		Preload("Owner").
		Preload("Admin").
		Preload("Members").
		Preload("Supervisors").
		First(&project, id)

	c.JSON(http.StatusOK, gin.H{"message": "Project updated successfully", "project": project})
}

// DeleteProject archives a project. Per the spec's "no hard delete,
// ever" principle, this does NOT call GORM's Delete() — that sets
// DeletedAt and hides the record from every default query, which is the
// opposite of "must be visible somewhere to authorized management."
// Instead this sets Status to "archived" and stamps who/when. An
// archived project stays reachable via GET /projects/:id always, and via
// GET /projects?status=archived — it's just excluded from the default,
// no-filter list view so day-to-day usage doesn't get cluttered with
// dead projects.
func DeleteProject(c *gin.Context) {
	id := c.Param("id")

	userIDVal, _ := c.Get("user_id")
	userRoleVal, _ := c.Get("user_role")
	currentUserID := userIDVal.(uint)
	currentUserRole := userRoleVal.(string)

	var project models.Project
	if err := database.DB.First(&project, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch project"})
		return
	}

	// Privacy check (see visibility.go)
	if !userCanAccessProject(c, &project) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Only super_admin and admin can archive
	if currentUserRole != "super_admin" && currentUserRole != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient permissions to archive project"})
		return
	}

	now := time.Now()
	if err := database.DB.Model(&project).Updates(map[string]interface{}{
		"status":         "archived",
		"archived_at":    now,
		"archived_by_id": currentUserID,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to archive project"})
		return
	}

	utils.LogAudit(currentUserID, "archived", "project", project.ID,
		fmt.Sprintf("Archived project %s: %s", project.Code, project.Title), c.ClientIP(), c.Request.UserAgent())

	c.JSON(http.StatusOK, gin.H{"message": "Project archived successfully"})
}

// GetProjectStats returns statistics for a project
func GetProjectStats(c *gin.Context) {
	id := c.Param("id")

	var project models.Project
	if err := database.DB.First(&project, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch project"})
		return
	}
	// This endpoint had NO access check: any logged-in user could read any
	// project's task/ticket counts, budget and hours by id.
	if !userCanAccessProject(c, &project) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	var taskStats struct {
		Total      int64
		Todo       int64
		InProgress int64
		Done       int64
	}
	database.DB.Model(&models.Task{}).Where("project_id = ?", id).Count(&taskStats.Total)
	database.DB.Model(&models.Task{}).Where("project_id = ? AND status = ?", id, "todo").Count(&taskStats.Todo)
	database.DB.Model(&models.Task{}).Where("project_id = ? AND status = ?", id, "in_progress").Count(&taskStats.InProgress)
	database.DB.Model(&models.Task{}).Where("project_id = ? AND status = ?", id, "done").Count(&taskStats.Done)

	var ticketStats struct {
		Total  int64
		Open   int64
		Closed int64
	}
	database.DB.Model(&models.Ticket{}).Where("project_id = ?", id).Count(&ticketStats.Total)
	database.DB.Model(&models.Ticket{}).Where("project_id = ? AND status IN ?", id, []string{"new", "assigned", "in_progress", "pending"}).Count(&ticketStats.Open)
	database.DB.Model(&models.Ticket{}).Where("project_id = ? AND status IN ?", id, []string{"resolved", "closed"}).Count(&ticketStats.Closed)

	var spentHours float64
	database.DB.Model(&models.WorkLog{}).Where("project_id = ?", id).Select("COALESCE(SUM(hours), 0)").Scan(&spentHours)

	c.JSON(http.StatusOK, gin.H{
		"project_id":   project.ID,
		"code":         project.Code,
		"title":        project.Title,
		"progress":     project.Progress,
		"budget_hours": project.BudgetHours,
		"spent_hours":  spentHours,
		"tasks":        taskStats,
		"tickets":      ticketStats,
	})
}
