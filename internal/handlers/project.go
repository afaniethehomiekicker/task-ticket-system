package handlers

import (
	"fmt"
	"log"
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
	Code        string     `json:"code"` // optional — auto-generated (PRJ-000001 style) if omitted
	Title       string     `json:"title" binding:"required"`
	Description string     `json:"description"`
	Type        string     `json:"type"`       // general, ticketing
	Department  string     `json:"department"` // owning department
	Status      string     `json:"status"`
	Priority    string     `json:"priority"`
	StartDate   *time.Time `json:"start_date"`
	DueDate     *time.Time `json:"due_date"`
	ClientID    *uint      `json:"client_id"`
	ClientIDs   []uint     `json:"client_ids"` // all clients (slide 9); first = primary
	OwnerID     *uint      `json:"owner_id"`
	AdminID     *uint      `json:"admin_id"`
	BudgetHours float64    `json:"budget_hours"`
	// Budget as entered: a number in "hours" or "days" (1 day = 8 h). When
	// sent, budget_hours is derived from it.
	BudgetValue   *float64 `json:"budget_value"`
	BudgetUnit    string   `json:"budget_unit"`
	MemberIDs     []uint   `json:"member_ids"`
	SupervisorIDs []uint   `json:"supervisor_ids"`
}

type UpdateProjectInput struct {
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Type        string     `json:"type"`
	Department  string     `json:"department"`
	Status      string     `json:"status"`
	Priority    string     `json:"priority"`
	StartDate   *time.Time `json:"start_date"`
	DueDate     *time.Time `json:"due_date"`
	ClientID    *uint      `json:"client_id"`
	ClientIDs   []uint     `json:"client_ids"` // replaces the linked clients when sent
	OwnerID     *uint      `json:"owner_id"`
	AdminID     *uint      `json:"admin_id"`
	BudgetHours float64    `json:"budget_hours"`
	// Budget as entered: a number in "hours" or "days" (1 day = 8 h). When
	// sent, budget_hours is derived from it.
	BudgetValue   *float64 `json:"budget_value"`
	BudgetUnit    string   `json:"budget_unit"`
	Progress      *int     `json:"progress"` // pointer: "not sent" must not mean "0"
	MemberIDs     []uint   `json:"member_ids"`
	SupervisorIDs []uint   `json:"supervisor_ids"`
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
		Preload("Clients").
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
		// Any linked client, not just the primary one.
		query = query.Where("(projects.client_id = ? OR projects.id IN (SELECT project_id FROM project_clients WHERE client_id = ?))", params.ClientID, params.ClientID)
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

	fillProjectProgress(projects) // progress from tasks, not a stale stored number
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
		Preload("Clients").
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

	fillOneProjectProgress(&project)
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
		// Permanent ID from the atomic counter (spec slide 7).
		nextID, idErr := models.NextID(database.DB, "PRJ")
		if idErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to allocate a project code"})
			return
		}
		code = nextID
	}

	// Validate unique code (only meaningful now for an explicitly-
	// supplied code — an auto-generated one is unique by construction).
	var existing models.Project
	if err := database.DB.Where("code = ?", code).First(&existing).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Project code already exists"})
		return
	}

	// Clients: client_ids (several, slide 9) or the older single client_id.
	clientIDs, msg := resolveProjectClients(input.ClientID, input.ClientIDs, nil)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if len(clientIDs) > 0 {
		input.ClientID = &clientIDs[0]
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

	budgetValue, budgetUnit, budgetHours, msg := resolveBudget(input.BudgetValue, input.BudgetUnit, input.BudgetHours)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
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
		BudgetHours: budgetHours,
		BudgetValue: budgetValue,
		BudgetUnit:  budgetUnit,
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
		serverError(c, "Failed to create project", err)
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

	// All linked clients (slide 9); client_id is the first.
	if len(clientIDs) > 0 {
		if err := setProjectClients(database.DB, &project, clientIDs); err != nil {
			log.Printf("projects: linking clients to %s failed: %v", project.Code, err)
		}
	}

	utils.LogAudit(currentUserID, "created", "project", project.ID,
		fmt.Sprintf("Created project %s: %s", project.Code, project.Title), c.ClientIP(), c.Request.UserAgent())

	// Reload
	database.DB.
		Preload("Client").
		Preload("Clients").
		Preload("Owner").
		Preload("Admin").
		Preload("Members").
		Preload("Supervisors").
		First(&project, project.ID)

	fillOneProjectProgress(&project)
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
		utils.LogAuditWithValues(currentUserID, "status_changed", "project", project.ID,
			statusChange(project.Status), statusChange(input.Status),
			fmt.Sprintf("Project %s: %s -> %s", project.Code, project.Status, input.Status),
			c.ClientIP(), c.Request.UserAgent())
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
	// Clients (slide 9). client_ids replaces the whole set; a lone client_id
	// (older callers) replaces it with that one client. Clients already
	// linked may stay even if archived since. Applied after the other
	// updates, below.
	var newClientIDs []uint
	clientsChanging := false
	oldClientIDs := linkedClientIDs(&project)
	if input.ClientIDs != nil || input.ClientID != nil {
		keep := map[uint]bool{}
		for _, id := range oldClientIDs {
			keep[id] = true
		}
		ids, msg := resolveProjectClients(input.ClientID, input.ClientIDs, keep)
		if msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		if len(ids) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "A project needs at least one client"})
			return
		}
		newClientIDs = ids
		clientsChanging = fmt.Sprint(ids) != fmt.Sprint(oldClientIDs)
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
	if input.BudgetValue != nil || input.BudgetUnit != "" || input.BudgetHours > 0 {
		unit := input.BudgetUnit
		if unit == "" && input.BudgetValue != nil {
			unit = project.BudgetUnit // same unit as before when only the number changes
		}
		v, u, h, msg := resolveBudget(input.BudgetValue, unit, input.BudgetHours)
		if msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		updates["budget_value"] = v
		updates["budget_unit"] = u
		updates["budget_hours"] = h
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

	if clientsChanging {
		if err := setProjectClients(database.DB, &project, newClientIDs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update the project's clients"})
			return
		}
		utils.LogAuditWithValues(currentUserID, "updated", "project", project.ID,
			map[string]interface{}{"clients": clientNames(oldClientIDs)},
			map[string]interface{}{"clients": clientNames(newClientIDs)},
			fmt.Sprintf("Project %s clients: %s -> %s", project.Code, clientNames(oldClientIDs), clientNames(newClientIDs)),
			c.ClientIP(), c.Request.UserAgent())
	}

	database.DB.First(&project, id)

	utils.LogAudit(currentUserID, "updated", "project", project.ID,
		fmt.Sprintf("Updated project %s", project.Code), c.ClientIP(), c.Request.UserAgent())

	// Reload
	database.DB.
		Preload("Client").
		Preload("Clients").
		Preload("Owner").
		Preload("Admin").
		Preload("Members").
		Preload("Supervisors").
		First(&project, id)

	fillOneProjectProgress(&project)
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
	currentUserID := userIDVal.(uint)

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

	// The archive_records matrix permission (see restore.go).
	if !canArchiveRecords(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient permissions to archive project"})
		return
	}

	// Archiving twice would overwrite pre_archive_status with "archived",
	// losing the status Restore needs.
	if project.Status == "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already archived"})
		return
	}

	now := time.Now()
	if err := database.DB.Model(&project).Updates(map[string]interface{}{
		"status":             "archived",
		"pre_archive_status": project.Status,
		"archived_at":        now,
		"archived_by_id":     currentUserID,
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

// hoursPerDay converts a budget in days to hours.
const hoursPerDay = 8.0

// resolveBudget turns what the form sent into (value, unit, hours). A value
// with a unit wins; otherwise a plain budget_hours (older callers) is taken
// as hours.
func resolveBudget(value *float64, unit string, hours float64) (float64, string, float64, string) {
	unit = strings.ToLower(strings.TrimSpace(unit))
	if value != nil {
		if *value < 0 {
			return 0, "", 0, "Budget can't be negative"
		}
		switch unit {
		case "", "hours":
			return *value, "hours", *value, ""
		case "days":
			return *value, "days", *value * hoursPerDay, ""
		default:
			return 0, "", 0, "Budget unit must be hours or days"
		}
	}
	if hours < 0 {
		return 0, "", 0, "Budget can't be negative"
	}
	return hours, "hours", hours, ""
}

// ---- Progress, calculated from the project's tasks ----------------------------
//
// A project's progress used to be a stored number nothing ever updated, so
// every project showed 0% however many tasks were done. It's now worked out
// from the tasks each time projects are returned: finished tasks (status
// category "done") / all tasks, leaving out cancelled and archived ones. A
// project with no tasks keeps its stored (manually set) progress.
//
// TaskCounts carries the numbers behind it for display ("3 of 5 tasks").

type projectTaskCounts struct {
	ProjectID uint
	Total     int64
	Done      int64
}

func fillProjectProgress(projects []models.Project) {
	if len(projects) == 0 {
		return
	}
	ids := make([]uint, 0, len(projects))
	for _, p := range projects {
		ids = append(ids, p.ID)
	}
	var rows []projectTaskCounts
	database.DB.Model(&models.Task{}).
		Select("project_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE status IN ?) AS done",
			statusKeysIn("task", "done")).
		Where("project_id IN ? AND status NOT IN ?", ids, append(statusKeysIn("task", "cancelled"), "archived")).
		Group("project_id").
		Scan(&rows)
	byID := map[uint]projectTaskCounts{}
	for _, r := range rows {
		byID[r.ProjectID] = r
	}
	for i := range projects {
		r, ok := byID[projects[i].ID]
		if !ok || r.Total == 0 {
			continue
		}
		projects[i].Progress = int(r.Done * 100 / r.Total)
		projects[i].TasksTotal = int(r.Total)
		projects[i].TasksDone = int(r.Done)
	}
}

func fillOneProjectProgress(p *models.Project) {
	list := []models.Project{*p}
	fillProjectProgress(list)
	p.Progress, p.TasksTotal, p.TasksDone = list[0].Progress, list[0].TasksTotal, list[0].TasksDone
}

// ---- Project status follows its tasks -----------------------------------------
//
// A project's status could not be changed at all (no field in the edit form)
// and nothing updated it, so every project sat in "Planning" forever and the
// dashboard's Running Projects card read 0. It now moves with the work:
//
//	planning  -> active     when any task is started (or finished)
//	planning/active -> completed   when every task is done
//	completed -> active     when a task is reopened or a new one added
//
// "on_hold" and "cancelled" are deliberate decisions and are never changed
// automatically. Cancelled / archived tasks don't count. Each automatic change
// is written to the project's audit history.
func syncProjectStatusFromTasks(projectID *uint, actorID uint) {
	if projectID == nil || *projectID == 0 {
		return
	}
	var project models.Project
	if err := database.DB.First(&project, *projectID).Error; err != nil {
		return
	}
	if project.Status != "planning" && project.Status != "active" && project.Status != "completed" {
		return
	}
	excluded := append(statusKeysIn("task", "cancelled"), "archived")
	var total, done, started int64
	base := database.DB.Model(&models.Task{}).Where("project_id = ? AND status NOT IN ?", project.ID, excluded)
	base.Session(&gorm.Session{}).Count(&total)
	base.Session(&gorm.Session{}).Where("status IN ?", statusKeysIn("task", "done")).Count(&done)
	base.Session(&gorm.Session{}).Where("status NOT IN ?", statusKeysIn("task", "open")).Count(&started)

	next := project.Status
	reason := ""
	switch {
	case total > 0 && done == total && project.Status != "completed":
		next, reason = "completed", "all tasks are done"
	case project.Status == "completed" && total > 0 && done < total:
		next, reason = "active", "a task was reopened or added"
	case project.Status == "planning" && started > 0:
		next, reason = "active", "work has started on its tasks"
	}
	if next == project.Status {
		return
	}
	prev := project.Status // Updates() below overwrites project.Status
	autoUpdates := map[string]interface{}{"status": next}
	if next == "completed" && project.CompletedAt == nil {
		autoUpdates["completed_at"] = time.Now()
	}
	if err := database.DB.Model(&project).Updates(autoUpdates).Error; err != nil {
		log.Printf("projects: auto status for %s failed: %v", project.Code, err)
		return
	}
	utils.LogAuditWithValues(actorID, "status_changed", "project", project.ID,
		statusChange(prev), statusChangeWithReason(next, "automatic: "+reason),
		fmt.Sprintf("Project %s: %s -> %s (automatic — %s)", project.Code, prev, next, reason),
		"", "")
}

// SyncAllProjectStatuses brings every planning / active / completed project in
// line with its tasks once at startup (so existing projects don't wait for
// their next task change). Idempotent.
func SyncAllProjectStatuses() {
	var ids []uint
	database.DB.Model(&models.Project{}).Where("status IN ?", []string{"planning", "active", "completed"}).Pluck("id", &ids)
	for _, id := range ids {
		pid := id
		syncProjectStatusFromTasks(&pid, 0)
	}
}
