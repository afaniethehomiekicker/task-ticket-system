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

type CreateTicketInput struct {
	TicketNumber string `json:"ticket_number"`
	Title        string `json:"title" binding:"required"`
	Description  string `json:"description"`
	Category     string `json:"category"`   // incident, request, problem, change
	Priority     string `json:"priority"`   // low, normal, high, critical
	Severity     string `json:"severity"`   // minor, major, critical
	Source       string `json:"source"`     // email, phone, portal, chat
	Department   string `json:"department"` // owning department

	ClientID     *uint `json:"client_id"`
	ProjectID    *uint `json:"project_id"`
	AssignedToID *uint `json:"assigned_to_id"`

	// SLA
	SLAHours int `json:"sla_hours"` // e.g., 4, 8, 24
}

type UpdateTicketInput struct {
	Title        string `json:"title"`
	Description  string `json:"description"`
	Category     string `json:"category"`
	Priority     string `json:"priority"`
	Severity     string `json:"severity"`
	Status       string `json:"status"`
	Department   string `json:"department"`
	AssignedToID *uint  `json:"assigned_to_id"`
	ProjectID    *uint  `json:"project_id"`
	IsPinned     *bool  `json:"is_pinned"`
}

type TicketQueryParams struct {
	Status       string `form:"status"`
	Priority     string `form:"priority"`
	Category     string `form:"category"`
	Department   string `form:"department"`
	AssignedToID string `form:"assigned_to_id"`
	ClientID     string `form:"client_id"`
	ProjectID    string `form:"project_id"`
	Search       string `form:"search"`
	Page         int    `form:"page,default=1"`
	Limit        int    `form:"limit,default=20"`
	SortBy       string `form:"sort_by,default=created_at"`
	SortOrder    string `form:"sort_order,default=desc"`
}

// Sortable columns for GET /api/tickets (whitelist — see safeOrderClause).
var ticketSortColumns = map[string]string{
	"created_at":    "tickets.created_at",
	"updated_at":    "tickets.updated_at",
	"priority":      "tickets.priority",
	"severity":      "tickets.severity",
	"status":        "tickets.status",
	"title":         "tickets.title",
	"ticket_number": "tickets.ticket_number",
	"sla_deadline":  "tickets.sla_deadline",
}

// GetTickets returns paginated tickets with department-level privacy filtering
func GetTickets(c *gin.Context) {
	var params TicketQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	params.Page, params.Limit = clampPagination(params.Page, params.Limit)

	userRoleVal, _ := c.Get("user_role")
	currentUserRole := userRoleVal.(string)

	query := database.DB.
		Preload("Client").
		Preload("Project").
		Preload("AssignedTo").
		Preload("CreatedBy").
		Preload("Comments.User").
		Order(safeOrderClause(params.SortBy, params.SortOrder, ticketSortColumns, "tickets.created_at"))

	// Visibility (see visibility.go): admins their department, supervisors their
	// own and their team's tickets, staff the tickets assigned to or created by
	// them. Applied in SQL so the API never returns what the UI would hide.
	query = applyTicketScope(query, viewerFrom(c))

	// Apply filters
	if params.Status != "" {
		query = query.Where("status = ?", params.Status)
	} else {
		// See the matching comment in projects.go's GetProjects.
		query = query.Where("status != ?", "archived")
	}
	if params.Priority != "" {
		query = query.Where("priority = ?", params.Priority)
	}
	if params.Category != "" {
		query = query.Where("category = ?", params.Category)
	}
	if params.Department != "" && (currentUserRole == "super_admin" || currentUserRole == "admin") {
		query = query.Where("department = ?", params.Department)
	}
	if params.AssignedToID != "" {
		query = query.Where("assigned_to_id = ?", params.AssignedToID)
	}
	if params.ClientID != "" {
		query = query.Where("client_id = ?", params.ClientID)
	}
	if params.ProjectID != "" {
		query = query.Where("project_id = ?", params.ProjectID)
	}
	if params.Search != "" {
		searchTerm := "%" + strings.ToLower(params.Search) + "%"
		query = query.Where(
			"LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(ticket_number) LIKE ?",
			searchTerm, searchTerm, searchTerm,
		)
	}

	// Count total
	var total int64
	query.Model(&models.Ticket{}).Count(&total)

	// Pagination
	offset := (params.Page - 1) * params.Limit
	query = query.Offset(offset).Limit(params.Limit)

	var tickets []models.Ticket
	if err := query.Find(&tickets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch tickets"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"tickets": tickets,
		"pagination": gin.H{
			"page":  params.Page,
			"limit": params.Limit,
			"total": total,
			"pages": (total + int64(params.Limit) - 1) / int64(params.Limit),
		},
	})
}

// GetTicket returns a single ticket by ID
func GetTicket(c *gin.Context) {
	id := c.Param("id")

	query := database.DB.
		Preload("Client").
		Preload("Project").
		Preload("AssignedTo").
		Preload("CreatedBy").
		Preload("Comments.User").
		Preload("Attachments").
		Preload("Tasks.Assignee").
		Preload("WorkLogs.User")

	var ticket models.Ticket
	if err := query.First(&ticket, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch ticket"})
		return
	}

	// Privacy check (see visibility.go)
	if !userCanAccessTicket(c, &ticket) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ticket": ticket})
}

// CreateTicket creates a new ticket
func CreateTicket(c *gin.Context) {
	var input CreateTicketInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userIDVal, _ := c.Get("user_id")
	userDeptVal, _ := c.Get("user_department")
	currentUserID := userIDVal.(uint)
	currentUserDept := userDeptVal.(string)

	// Generate ticket number
	var maxNum int
	database.DB.Model(&models.Ticket{}).
		Where("ticket_number ~ '^TKT-[0-9]+$'").
		Select("COALESCE(MAX(CAST(SUBSTRING(ticket_number FROM 5) AS INTEGER)), 100000)").
		Scan(&maxNum)
	ticketNumber := fmt.Sprintf("TKT-%06d", maxNum+1)

	// Default department to user's department if not provided
	department := input.Department
	if department == "" {
		department = currentUserDept
	}

	// Calculate SLA deadline
	var slaDeadline *time.Time
	if input.SLAHours > 0 {
		deadline := time.Now().Add(time.Duration(input.SLAHours) * time.Hour)
		slaDeadline = &deadline
	}

	ticket := models.Ticket{
		TicketNumber: ticketNumber,
		Title:        input.Title,
		Description:  input.Description,
		Category:     input.Category,
		Priority:     input.Priority,
		Severity:     input.Severity,
		Source:       input.Source,
		Status:       "new",
		Department:   department,
		ClientID:     input.ClientID,
		ProjectID:    input.ProjectID,
		AssignedToID: input.AssignedToID,
		CreatedByID:  &currentUserID,
		SLADeadline:  slaDeadline,
	}

	// Set defaults
	if ticket.Priority == "" {
		ticket.Priority = "normal"
	}
	if ticket.Severity == "" {
		ticket.Severity = "minor"
	}
	if ticket.Category == "" {
		ticket.Category = "incident"
	}

	// If assigned, set first response SLA based on priority
	if input.AssignedToID != nil {
		now := time.Now()
		ticket.FirstResponseAt = &now
	}

	if err := database.DB.Create(&ticket).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create ticket: " + err.Error()})
		return
	}

	utils.LogAudit(currentUserID, "created", "ticket", ticket.ID,
		fmt.Sprintf("Created ticket %s: %s", ticket.TicketNumber, ticket.Title), c.ClientIP(), c.Request.UserAgent())

	// Reload with relations
	database.DB.
		Preload("Client").
		Preload("Project").
		Preload("AssignedTo").
		Preload("CreatedBy").
		First(&ticket, ticket.ID)

	c.JSON(http.StatusCreated, gin.H{"message": "Ticket created successfully", "ticket": ticket})
}

// UpdateTicket updates an existing ticket
func UpdateTicket(c *gin.Context) {
	id := c.Param("id")

	userIDVal, _ := c.Get("user_id")
	userRoleVal, _ := c.Get("user_role")
	currentUserID := userIDVal.(uint)
	currentUserRole := userRoleVal.(string)

	var ticket models.Ticket
	if err := database.DB.First(&ticket, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch ticket"})
		return
	}

	// Privacy check (see visibility.go)
	if !userCanAccessTicket(c, &ticket) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	var input UpdateTicketInput
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
	if input.Category != "" {
		updates["category"] = input.Category
	}
	if input.Priority != "" {
		updates["priority"] = input.Priority
	}
	if input.Severity != "" {
		updates["severity"] = input.Severity
	}
	// An unchanged status is a no-op (edit forms resend the current one).
	if input.Status != "" && input.Status != ticket.Status {
		// Same rule as UpdateTicketStatus below: "archived" can only be
		// set via DeleteTicket, which is permission-gated and stamps
		// ArchivedAt/ArchivedByID. This generic update endpoint has no
		// such restriction, so it must not accept it either.
		if input.Status == "archived" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Use the archive/delete action to archive a ticket"})
			return
		}
		// This endpoint used to accept any string at all.
		if !validGenericTicketStatus(input.Status) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid status"})
			return
		}
		updates["status"] = input.Status
		// Auto-set timestamps on status transitions
		switch input.Status {
		case "resolved":
			now := time.Now()
			updates["resolved_at"] = now
			// Was `if ticket.ResolvedAt == nil` — which OVERWROTE an existing
			// first_response_at with the resolution time, wrecking the
			// first-response SLA figure for every resolved ticket.
			if ticket.FirstResponseAt == nil {
				updates["first_response_at"] = now
			}
		case "closed":
			now := time.Now()
			updates["closed_at"] = now
		case "in_progress":
			if ticket.FirstResponseAt == nil {
				now := time.Now()
				updates["first_response_at"] = now
			}
		}
	}
	if input.Department != "" && (currentUserRole == "super_admin" || currentUserRole == "admin") {
		updates["department"] = input.Department
	}
	if input.AssignedToID != nil {
		// Reassigning is the assign_tickets permission (POST /:id/assign is
		// gated on it); this endpoint let anyone with access do it anyway.
		changing := ticket.AssignedToID == nil || *ticket.AssignedToID != *input.AssignedToID
		if changing && !canAssignWork(currentUserRole) {
			c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to reassign tickets"})
			return
		}
		updates["assigned_to_id"] = *input.AssignedToID
	}
	if input.ProjectID != nil {
		updates["project_id"] = *input.ProjectID
	}
	if input.IsPinned != nil && ticketHasColumn("is_pinned") {
		updates["is_pinned"] = *input.IsPinned
	}

	if len(updates) > 0 {
		if err := database.DB.Model(&ticket).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update ticket"})
			return
		}
	}

	// Reload for audit
	database.DB.First(&ticket, id)

	utils.LogAudit(currentUserID, "updated", "ticket", ticket.ID,
		fmt.Sprintf("Updated ticket %s", ticket.TicketNumber), c.ClientIP(), c.Request.UserAgent())

	// Reload with relations
	database.DB.
		Preload("Client").
		Preload("Project").
		Preload("AssignedTo").
		Preload("CreatedBy").
		First(&ticket, id)

	c.JSON(http.StatusOK, gin.H{"message": "Ticket updated successfully", "ticket": ticket})
}

// DeleteTicket archives a ticket — see the matching comment on
// DeleteProject in projects.go for why this replaces GORM soft-delete.
func DeleteTicket(c *gin.Context) {
	id := c.Param("id")

	userIDVal, _ := c.Get("user_id")
	userRoleVal, _ := c.Get("user_role")
	currentUserID := userIDVal.(uint)
	currentUserRole := userRoleVal.(string)

	var ticket models.Ticket
	if err := database.DB.First(&ticket, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch ticket"})
		return
	}

	// Privacy check (see visibility.go)
	if !userCanAccessTicket(c, &ticket) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Only super_admin and admin can archive
	if currentUserRole != "super_admin" && currentUserRole != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient permissions to archive ticket"})
		return
	}

	now := time.Now()
	if err := database.DB.Model(&ticket).Updates(map[string]interface{}{
		"status":         "archived",
		"archived_at":    now,
		"archived_by_id": currentUserID,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to archive ticket"})
		return
	}

	utils.LogAudit(currentUserID, "archived", "ticket", ticket.ID,
		fmt.Sprintf("Archived ticket %s: %s", ticket.TicketNumber, ticket.Title), c.ClientIP(), c.Request.UserAgent())

	c.JSON(http.StatusOK, gin.H{"message": "Ticket archived successfully"})
}

// UpdateTicketStatus updates just the status with SLA tracking
func UpdateTicketStatus(c *gin.Context) {
	id := c.Param("id")

	userIDVal, _ := c.Get("user_id")
	currentUserID := userIDVal.(uint)

	var ticket models.Ticket
	if err := database.DB.First(&ticket, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch ticket"})
		return
	}

	// Privacy check (see visibility.go)
	if !userCanAccessTicket(c, &ticket) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	var input struct {
		Status            string `json:"status" binding:"required"`
		ResolutionSummary string `json:"resolution_summary"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate status transition
	validStatuses := []string{"new", "assigned", "in_progress", "pending", "resolved", "closed", "cancelled"}
	// "archived" deliberately excluded — see the comment in UpdateTicket
	// above; only DeleteTicket's permission-gated path can set it.
	valid := false
	for _, s := range validStatuses {
		if s == input.Status {
			valid = true
			break
		}
	}
	if !valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid status"})
		return
	}

	// Capture BEFORE Updates(): GORM writes map-update values back into the
	// model struct, so ticket.Status is already the new value afterwards and
	// the audit log used to read "from X to X".
	oldStatus := ticket.Status

	updates := map[string]interface{}{
		"status": input.Status,
	}

	now := time.Now()
	switch input.Status {
	case "assigned":
		if ticket.FirstResponseAt == nil {
			updates["first_response_at"] = now
		}
	case "in_progress":
		if ticket.FirstResponseAt == nil {
			updates["first_response_at"] = now
		}
	case "resolved":
		updates["resolved_at"] = now
	case "closed":
		updates["closed_at"] = now
	}

	if input.ResolutionSummary != "" {
		updates["resolution_summary"] = input.ResolutionSummary
	}

	if err := database.DB.Model(&ticket).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update status"})
		return
	}

	utils.LogAuditWithValues(currentUserID, "status_changed", "ticket", ticket.ID,
		statusChange(oldStatus), statusChange(input.Status),
		fmt.Sprintf("Status changed from %s to %s", oldStatus, input.Status), c.ClientIP(), c.Request.UserAgent())

	database.DB.First(&ticket, id)
	c.JSON(http.StatusOK, gin.H{"message": "Status updated successfully", "ticket": ticket})
}

// AssignTicket assigns a ticket to a user
func AssignTicket(c *gin.Context) {
	id := c.Param("id")

	userIDVal, _ := c.Get("user_id")
	userRoleVal, _ := c.Get("user_role")
	userDeptVal, _ := c.Get("user_department")
	currentUserID := userIDVal.(uint)
	currentUserRole := userRoleVal.(string)
	currentUserDept := userDeptVal.(string)

	var ticket models.Ticket
	if err := database.DB.First(&ticket, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch ticket"})
		return
	}

	// Privacy check (see visibility.go)
	if !userCanAccessTicket(c, &ticket) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	var input struct {
		AssignedToID uint `json:"assigned_to_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify assignee exists and is in same department (unless admin)
	var assignee models.User
	if err := database.DB.First(&assignee, input.AssignedToID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Assignee not found"})
		return
	}

	if currentUserRole != "super_admin" && currentUserRole != "admin" {
		if assignee.Department != currentUserDept {
			c.JSON(http.StatusForbidden, gin.H{"error": "Can only assign to users in your department"})
			return
		}
	}

	updates := map[string]interface{}{
		"assigned_to_id": input.AssignedToID,
		"status":         "assigned",
	}
	if ticket.FirstResponseAt == nil {
		now := time.Now()
		updates["first_response_at"] = now
	}

	if err := database.DB.Model(&ticket).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to assign ticket"})
		return
	}

	utils.LogAudit(currentUserID, "assigned", "ticket", ticket.ID,
		fmt.Sprintf("Assigned ticket %s to user %d", ticket.TicketNumber, input.AssignedToID), c.ClientIP(), c.Request.UserAgent())

	database.DB.Preload("AssignedTo").First(&ticket, id)
	c.JSON(http.StatusOK, gin.H{"message": "Ticket assigned successfully", "ticket": ticket})
}

// validGenericTicketStatus lists the statuses PUT /tickets/:id may set — the
// same set UpdateTicketStatus accepts. "escalated" is deliberately absent
// (escalation is its own action with a required reason) and so is "archived".
func validGenericTicketStatus(s string) bool {
	switch s {
	case "new", "assigned", "in_progress", "pending", "resolved", "closed", "cancelled":
		return true
	}
	return false
}
