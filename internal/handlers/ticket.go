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

	// SLA. Either may be sent; sla_minutes wins. If neither is sent the
	// deadline comes from the ticket's priority (defaultSLAMinutes), so
	// every ticket gets one — the spec requires SLA tracking on all of them.
	SLAHours   int `json:"sla_hours"`   // e.g., 4, 8, 24
	SLAMinutes int `json:"sla_minutes"` // e.g., 30 for critical

	// Private: only the people on the ticket (and their managers) see it.
	// Off by default: its departments can view it (visibility.go).
	IsPrivate bool `json:"is_private"`
}

// defaultSLAMinutes is the resolution SLA per priority, taken from the
// spec's example table (Critical 30 min, High 1 h, Normal 4 h). Low isn't
// in the spec; 24 h is a placeholder. Phase 2 moves this into a Super
// Admin–editable setting; until then it lives here.
var defaultSLAMinutes = map[string]int{
	"critical": 30,
	"high":     60,
	"normal":   240,
	"low":      1440,
}

func validTicketPriority(p string) bool {
	_, ok := defaultSLAMinutes[p]
	return ok
}

// Ticket severities (models.Ticket.Severity). Severity used to be stored
// as-is, so any text ended up in the column and broke filters and exports.
var ticketSeverities = map[string]bool{"minor": true, "major": true, "critical": true}

func validTicketSeverity(s string) bool { return ticketSeverities[s] }

type UpdateTicketInput struct {
	// Required when the new status requires a reason (workflow catalog).
	StatusReason string `json:"status_reason"`
	// Saved with the ticket; also counts as the reason when resolving.
	ResolutionSummary string `json:"resolution_summary"`
	Title             string `json:"title"`
	Description       string `json:"description"`
	Category          string `json:"category"`
	Priority          string `json:"priority"`
	Severity          string `json:"severity"`
	Status            string `json:"status"`
	Department        string `json:"department"`
	AssignedToID      *uint  `json:"assigned_to_id"`
	ProjectID         *uint  `json:"project_id"`
	IsPinned          *bool  `json:"is_pinned"`
	// Private / department-visible (canSetPrivacy).
	IsPrivate *bool `json:"is_private"`
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
	// The Tickets page's sort: sla | priority | date. Pinned tickets first.
	// When set, it replaces sort_by / sort_order.
	Sort string `form:"sort"`
	// breached | near | within | none (same rules as ticketSlaState in
	// the frontend's permissions.js).
	SLA string `form:"sla"`
	// "1": the working set loaded at sign-in — unfinished tickets, tickets
	// finished in the last 30 days, and tickets the caller pinned. History
	// beyond that is fetched page by page.
	Working string `form:"working"`
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

	query := database.DB.
		Preload("Client").
		Preload("Project").
		Preload("AssignedTo", userCard).
		Preload("AssignedBy", userBasics).
		Preload("CreatedBy", userCard)
	// No comments in the list (see GetTasks): the ticket drawer loads them
	// when it opens (GET /api/tickets/:id/comments). The order is added
	// below (sort or sort_by).

	// Visibility (see visibility.go): admins their department, supervisors their
	// own and their team's tickets, staff the tickets assigned to or created by
	// them. Applied in SQL so the API never returns what the UI would hide.
	query = applyTicketScope(query, viewerFrom(c))

	// Apply filters
	// Finished = a "done" or "cancelled" category in the status catalog.
	finished := statusKeysIn("ticket", "done", "cancelled")
	switch params.Status {
	case "":
		// See the matching comment in projects.go's GetProjects.
		query = query.Where("tickets.status != ?", "archived")
	case "open": // anything not finished (dashboard drill-down)
		query = query.Where("tickets.status != ? AND tickets.status NOT IN ?", "archived", finished)
	case "escalated": // not a status: any escalation tier
		query = query.Where("tickets.status != ? AND COALESCE(tickets.escalation_level, 'none') NOT IN ('', 'none')", "archived")
	default:
		query = query.Where("tickets.status = ?", params.Status)
	}
	if params.Working == "1" {
		query = query.Where(fmt.Sprintf(`(tickets.status NOT IN ? OR tickets.updated_at >= ?
			OR EXISTS (SELECT 1 FROM pins WHERE pins.user_id = %d AND pins.record_type = 'ticket' AND pins.record_id = tickets.id))`,
			viewerFrom(c).ID), finished, time.Now().AddDate(0, 0, -30))
	}
	// SLA state. "now" is the database clock, as for every other time here.
	notFinished := "tickets.status NOT IN ? AND tickets.status != 'archived'"
	nearCond := "(tickets.sla_deadline - NOW() < INTERVAL '1 hour' OR (tickets.sla_deadline - NOW()) < (tickets.sla_deadline - tickets.created_at) * 0.25)"
	switch params.SLA {
	case "breached":
		query = query.Where(notFinished+" AND tickets.sla_deadline IS NOT NULL AND tickets.sla_deadline < NOW()", finished)
	case "near":
		query = query.Where(notFinished+" AND tickets.sla_deadline >= NOW() AND "+nearCond, finished)
	case "within":
		query = query.Where(notFinished+" AND tickets.sla_deadline >= NOW() AND NOT "+nearCond, finished)
	case "none":
		query = query.Where("(tickets.sla_deadline IS NULL OR tickets.status IN ? OR tickets.status = 'archived')", finished)
	}
	if params.Priority != "" {
		query = query.Where("priority = ?", params.Priority)
	}
	if params.Category != "" {
		query = query.Where("category = ?", params.Category)
	}
	// Any role: the visibility scope above already limits what's returned
	// (staff now see their departments' tickets, so they filter by it too).
	if d := strings.TrimSpace(params.Department); d != "" {
		query = query.Where("LOWER(TRIM(tickets.department)) = LOWER(?)", d)
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
	if search := strings.TrimSpace(params.Search); search != "" {
		searchTerm := "%" + strings.ToLower(search) + "%"
		query = query.Where(
			`(LOWER(tickets.title) LIKE ? OR LOWER(tickets.description) LIKE ? OR LOWER(tickets.ticket_number) LIKE ?
			OR EXISTS (SELECT 1 FROM clients WHERE clients.id = tickets.client_id AND clients.deleted_at IS NULL
				AND (LOWER(clients.company_name) LIKE ? OR LOWER(clients.contact_person) LIKE ?)))`,
			searchTerm, searchTerm, searchTerm, searchTerm, searchTerm,
		)
	}
	if params.Sort != "" {
		// The page's sort replaces sort_by: pinned first, then the sort.
		query = orderTickets(query, params.Sort, viewerFrom(c).ID)
	} else {
		query = query.Order(safeOrderClause(params.SortBy, params.SortOrder, ticketSortColumns, "tickets.created_at"))
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

	redactTickets(c, tickets)           // internal notes only for view_internal_notes
	applyTicketAccessLevels(c, tickets) // department viewers: read-only
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

// orderTickets — the caller's pinned tickets first, then sla (soonest
// deadline; none first, as the page always did), priority, or date (newest).
func orderTickets(q *gorm.DB, sort string, userID uint) *gorm.DB {
	q = q.Order(fmt.Sprintf(
		"(EXISTS (SELECT 1 FROM pins WHERE pins.user_id = %d AND pins.record_type = 'ticket' AND pins.record_id = tickets.id)) DESC",
		userID))
	switch sort {
	case "sla":
		q = q.Order("tickets.sla_deadline ASC NULLS FIRST")
	case "priority":
		q = q.Order("CASE tickets.priority WHEN 'critical' THEN 5 WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC")
	}
	return q.Order("tickets.created_at DESC").Order("tickets.id DESC")
}

// GetTicket returns a single ticket by ID
func GetTicket(c *gin.Context) {
	id := c.Param("id")

	query := database.DB.
		Preload("Client").
		Preload("Project").
		Preload("AssignedTo", userCard).
		Preload("AssignedBy", userBasics).
		Preload("CreatedBy", userCard).
		Preload("Comments.User", userCard).
		Preload("Attachments").
		Preload("Tasks.Assignee", userCard).
		Preload("WorkLogs.User", userCard)

	var ticket models.Ticket
	if err := query.First(&ticket, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch ticket"})
		return
	}

	// Privacy check (see visibility.go). Read access also covers the team
	// that returned the ticket (ticket_flow_rules.go); changes still need
	// userCanAccessTicket.
	if !userCanViewTicket(c, &ticket) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	redactTicket(c, &ticket) // internal notes only for view_internal_notes
	applyTicketAccessLevel(c, &ticket)
	if ticket.AccessLevel == "department" {
		// Linked tasks may be private or belong to people outside the
		// caller's departments: only the ones they could open themselves.
		visible := ticket.Tasks[:0]
		for i := range ticket.Tasks {
			if userCanViewTask(c, &ticket.Tasks[i]) {
				visible = append(visible, ticket.Tasks[i])
			}
		}
		ticket.Tasks = visible
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
	// Permanent ID from the atomic counter (spec slide 7) — "highest + 1"
	// could hand the same number to two records created together.
	ticketNumber, idErr := models.NextID(database.DB, "TKT")
	if idErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to allocate a ticket ID"})
		return
	}

	// Default department to user's department if not provided. A department
	// that doesn't exist used to be accepted as typed, and the ticket then
	// fell out of every department's view (only a super admin could see it).
	department := strings.TrimSpace(input.Department)
	if department == "" {
		department = currentUserDept
	}
	if !departmentIsKnown(department) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown department"})
		return
	}

	severity := strings.ToLower(strings.TrimSpace(input.Severity))
	if severity == "" {
		severity = "minor"
	}
	if !validTicketSeverity(severity) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid severity (use minor, major or critical)"})
		return
	}

	priority := strings.ToLower(strings.TrimSpace(input.Priority))
	if priority == "" {
		priority = "normal"
	}
	if !validTicketPriority(priority) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid priority (use low, normal, high or critical)"})
		return
	}
	if input.SLAMinutes < 0 || input.SLAHours < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "SLA cannot be negative"})
		return
	}

	// SLA deadline: explicit minutes, else explicit hours, else the
	// priority default. It used to be set only when sla_hours was sent,
	// and the frontend never sent it, so no ticket ever had a deadline and
	// nothing could ever show as breached.
	slaMinutes := input.SLAMinutes
	if slaMinutes == 0 && input.SLAHours > 0 {
		slaMinutes = input.SLAHours * 60
	}
	if slaMinutes == 0 {
		// Configurable per priority (Settings -> SLA, spec slide 22).
		slaMinutes = slaMinutesForPriority(priority)
	}
	deadline := time.Now().Add(time.Duration(slaMinutes) * time.Minute)
	slaDeadline := &deadline

	if msg := taskAssigneeRoleError(input.AssignedToID); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if msg := assigneeError(input.AssignedToID); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	// A pre-assigned person must be in the department the ticket is created
	// in (ticket_flow_rules.go); the guard in link_guard.go already checked
	// the caller may assign at all.
	if input.AssignedToID != nil && *input.AssignedToID != 0 {
		draft := models.Ticket{Department: department, OriginDepartment: department, CreatedByID: &currentUserID}
		if code, msg := ticketAssignError(c, &draft, *input.AssignedToID, false); code != 0 {
			c.JSON(code, gin.H{"error": msg})
			return
		}
	}
	// The client this ticket is for (slide 19: a customer query becomes a
	// ticket). Must exist and not be archived.
	if input.ClientID != nil && *input.ClientID != 0 {
		var cl models.Client
		if err := database.DB.Select("id", "status").First(&cl, *input.ClientID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Client not found"})
			return
		}
		if cl.Status == "archived" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "That client is archived"})
			return
		}
	} else {
		input.ClientID = nil
	}

	ticket := models.Ticket{
		TicketNumber: ticketNumber,
		Title:        input.Title,
		Description:  input.Description,
		Category:     input.Category,
		Priority:     priority,
		Severity:     severity,
		Source:       input.Source,
		Status:       "new",
		Department:   department,
		// Where the ticket came from — the creator's own department (e.g.
		// CNOC), so it can be routed on and returned (spec slide 19).
		OriginDepartment: func() string {
			if strings.TrimSpace(currentUserDept) != "" {
				return currentUserDept
			}
			return department
		}(),
		ClientID:     input.ClientID,
		ProjectID:    input.ProjectID,
		AssignedToID: input.AssignedToID,
		AssignedByID: func() *uint {
			if input.AssignedToID != nil {
				return &currentUserID
			}
			return nil
		}(),
		CreatedByID: &currentUserID,
		SLADeadline: slaDeadline,
		IsPrivate:   input.IsPrivate,
	}

	// Set defaults
	if ticket.Severity == "" {
		ticket.Severity = "minor"
	}
	if ticket.Category == "" {
		ticket.Category = "incident"
	}

	// Created with an assignee = already routed, so it starts as "assigned".
	// It used to stay "new" and, worse, got first_response_at stamped with
	// the creation time — assigning a ticket isn't responding to it, so the
	// first-response SLA read as met instantly for every pre-assigned ticket.
	// First response is now set only by a real response: the first public
	// reply (AddTicketComment) or the ticket moving to in_progress/resolved.
	if input.AssignedToID != nil {
		ticket.Status = "assigned"
	}

	if err := database.DB.Create(&ticket).Error; err != nil {
		serverError(c, "Failed to create ticket", err)
		return
	}

	utils.LogAudit(currentUserID, "created", "ticket", ticket.ID,
		fmt.Sprintf("Created ticket %s: %s", ticket.TicketNumber, ticket.Title), c.ClientIP(), c.Request.UserAgent())
	if ticket.AssignedToID != nil {
		notify(currentUserID, notice{"assignment", "New ticket: " + ticket.TicketNumber,
			fmt.Sprintf("%s assigned you %s (%s priority): %s", actorName(currentUserID), ticket.TicketNumber, ticket.Priority, ticket.Title),
			"ticket", ticket.ID}, *ticket.AssignedToID)
	}

	// Reload with relations
	database.DB.
		Preload("Client").
		Preload("Project").
		Preload("AssignedTo", userCard).
		Preload("AssignedBy", userBasics).
		Preload("CreatedBy", userCard).
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

	// Private / department-visible. Checked before anything is logged or
	// saved. An unchanged value is a no-op (edit forms resend the current one).
	privacyChange := input.IsPrivate != nil && *input.IsPrivate != ticket.IsPrivate
	if privacyChange && !canSetPrivacy(viewerFrom(c), ticket.CreatedByID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the person who created this ticket, a supervisor or an admin can change whether it is private"})
		return
	}

	updates := map[string]interface{}{}
	if privacyChange {
		updates["is_private"] = *input.IsPrivate
	}
	if input.Title != "" {
		updates["title"] = input.Title
	}
	if input.Description != "" {
		updates["description"] = input.Description
	}
	if input.Category != "" {
		updates["category"] = input.Category
	}
	// Priority and severity are validated whenever they CHANGE — open or
	// closed ticket alike. Priority used to be checked only on open tickets,
	// so a closed ticket accepted any text; severity was never checked. An
	// unchanged value is left alone (edit forms re-send the current one, and
	// an old ticket may still hold a legacy value).
	if p := strings.ToLower(strings.TrimSpace(input.Priority)); p != "" && p != ticket.Priority {
		if !validTicketPriority(p) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid priority (use low, normal, high or critical)"})
			return
		}
		updates["priority"] = p
		// A priority change re-targets the SLA from the ticket's creation time
		// (e.g. normal -> critical pulls the deadline in), unless it's finished.
		if !isFinishedTicketStatus(ticket.Status) {
			updates["sla_deadline"] = ticket.CreatedAt.Add(time.Duration(slaMinutesForPriority(p)) * time.Minute)
		}
	}
	if s := strings.ToLower(strings.TrimSpace(input.Severity)); s != "" && s != ticket.Severity {
		if !validTicketSeverity(s) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid severity (use minor, major or critical)"})
			return
		}
		updates["severity"] = s
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
		// Who may change it, and the Return / Reopen rules
		// (ticket_flow_rules.go).
		if code, msg := ticketStatusChangeError(c, &ticket, input.Status); code != 0 {
			c.JSON(code, gin.H{"error": msg})
			return
		}
		// This endpoint used to accept any string at all.
		if !validGenericTicketStatus(input.Status) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid status"})
			return
		}
		updates["status"] = input.Status
		reason := input.StatusReason
		if strings.TrimSpace(reason) == "" && input.Status == "resolved" {
			reason = input.ResolutionSummary // the resolution counts as the reason
		}
		if msg := statusReasonError("ticket", input.Status, reason); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		applyTicketStatusSideEffects(&ticket, input.Status, updates)
		if strings.TrimSpace(input.ResolutionSummary) != "" {
			updates["resolution_summary"] = strings.TrimSpace(input.ResolutionSummary)
		}
		utils.LogAuditWithValues(viewerFrom(c).ID, "status_changed", "ticket", ticket.ID,
			statusChange(ticket.Status), statusChangeWithReason(input.Status, reason),
			statusChangeDetails("ticket", ticket.Status, input.Status, reason), c.ClientIP(), c.Request.UserAgent())
	}
	// Moving a ticket to another department goes through Route (with a note,
	// on the timeline, by the team handling it). Editing the department
	// directly is left to super admins — it used to be open to any admin who
	// could see the ticket, including the raising department's, which side-
	// stepped every Route rule. An unchanged department is left alone.
	if d := strings.TrimSpace(input.Department); d != "" && !sameDept(d, ticket.Department) {
		if currentUserRole != "super_admin" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Use Route to send this ticket to another department"})
			return
		}
		canon, ok := canonicalDepartment(d)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown department"})
			return
		}
		updates["department"] = canon
	}
	if input.AssignedToID != nil {
		// Reassigning is the assign_tickets permission (POST /:id/assign is
		// gated on it); this endpoint let anyone with access do it anyway.
		changing := ticket.AssignedToID == nil || *ticket.AssignedToID != *input.AssignedToID
		if changing && !canAssignWork(currentUserRole) {
			if ok, msg := canTransferOwnWork(c, ticket.AssignedToID, input.AssignedToID); !ok {
				if msg == "" {
					msg = "You don't have permission to reassign tickets"
				}
				c.JSON(http.StatusForbidden, gin.H{"error": msg})
				return
			}
		}
		if changing {
			if msg := taskAssigneeRoleError(input.AssignedToID); msg != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": msg})
				return
			}
			// In the ticket's own department, by its handlers
			// (ticket_flow_rules.go).
			if code, msg := ticketAssignError(c, &ticket, *input.AssignedToID, canAssignWork(currentUserRole)); code != 0 {
				c.JSON(code, gin.H{"error": msg})
				return
			}
		}
		if changing {
			if msg := assigneeError(input.AssignedToID); msg != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": msg})
				return
			}
			utils.LogAuditWithValues(viewerFrom(c).ID, "transferred", "ticket", ticket.ID,
				map[string]interface{}{"assignee": assigneeLabel(ticket.AssignedToID)},
				map[string]interface{}{"assignee": assigneeLabel(input.AssignedToID)},
				fmt.Sprintf("Ticket %s transferred: %s -> %s", ticket.TicketNumber, assigneeLabel(ticket.AssignedToID), assigneeLabel(input.AssignedToID)),
				c.ClientIP(), c.Request.UserAgent())
			notify(viewerFrom(c).ID, notice{"transfer", "Ticket " + ticket.TicketNumber + " is now yours",
				fmt.Sprintf("%s passed %s to you: %s", actorName(viewerFrom(c).ID), ticket.TicketNumber, ticket.Title),
				"ticket", ticket.ID}, *input.AssignedToID)
		}
		updates["assigned_to_id"] = *input.AssignedToID
		if ticket.AssignedToID == nil || *ticket.AssignedToID != *input.AssignedToID {
			updates["assigned_by_id"] = viewerFrom(c).ID // who gave it to them
		}
	}
	if input.ProjectID != nil {
		updates["project_id"] = *input.ProjectID
	}
	if input.IsPinned != nil && ticketHasColumn("is_pinned") {
		updates["is_pinned"] = *input.IsPinned
	}

	before := ticket
	if len(updates) > 0 {
		if err := database.DB.Model(&ticket).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update ticket"})
			return
		}
	}

	// Reload for audit
	database.DB.First(&ticket, id)

	// Record exactly which fields changed, old -> new (status and assignee
	// changes have their own entries above).
	var after models.Ticket
	if err := database.DB.First(&after, ticket.ID).Error; err == nil {
		if oldV, newV, changed := fieldDiff(before, after, ticketDiffFields); len(changed) > 0 {
			utils.LogAuditWithValues(currentUserID, "updated", "ticket", ticket.ID, oldV, newV,
				fmt.Sprintf("Updated ticket %s: %s", ticket.TicketNumber, strings.Join(changed, ", ")),
				c.ClientIP(), c.Request.UserAgent())
		}
	}

	// Reload with relations
	database.DB.
		Preload("Client").
		Preload("Project").
		Preload("AssignedTo", userCard).
		Preload("AssignedBy", userBasics).
		Preload("CreatedBy", userCard).
		First(&ticket, id)

	c.JSON(http.StatusOK, gin.H{"message": "Ticket updated successfully", "ticket": ticket})
}

// DeleteTicket archives a ticket — see the matching comment on
// DeleteProject in projects.go for why this replaces GORM soft-delete.
func DeleteTicket(c *gin.Context) {
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

	// The archive_records matrix permission (see restore.go).
	if !canArchiveRecords(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient permissions to archive ticket"})
		return
	}

	// Archiving twice would overwrite pre_archive_status with "archived",
	// losing the status Restore needs.
	if ticket.Status == "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already archived"})
		return
	}

	now := time.Now()
	if err := database.DB.Model(&ticket).Updates(map[string]interface{}{
		"status":             "archived",
		"pre_archive_status": ticket.Status,
		"archived_at":        now,
		"archived_by_id":     currentUserID,
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
		Reason            string `json:"reason"` // required for some statuses (catalog)
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate against the configurable catalog ("archived" is never in it —
	// only DeleteTicket's permission-gated path can set that).
	if !validGenericTicketStatus(input.Status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid status"})
		return
	}
	// Who may change it, and the Return / Reopen rules
	// (ticket_flow_rules.go).
	if code, msg := ticketStatusChangeError(c, &ticket, input.Status); code != 0 {
		c.JSON(code, gin.H{"error": msg})
		return
	}
	reason := input.Reason
	if strings.TrimSpace(reason) == "" && input.Status == "resolved" {
		reason = input.ResolutionSummary // the resolution counts as the reason
	}
	if msg := statusReasonError("ticket", input.Status, reason); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	// Capture BEFORE Updates(): GORM writes map-update values back into the
	// model struct, so ticket.Status is already the new value afterwards and
	// the audit log used to read "from X to X".
	oldStatus := ticket.Status

	updates := map[string]interface{}{
		"status": input.Status,
	}

	applyTicketStatusSideEffects(&ticket, input.Status, updates)

	if input.ResolutionSummary != "" {
		updates["resolution_summary"] = input.ResolutionSummary
	}

	if err := database.DB.Model(&ticket).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update status"})
		return
	}

	utils.LogAuditWithValues(currentUserID, "status_changed", "ticket", ticket.ID,
		statusChange(oldStatus), statusChangeWithReason(input.Status, reason),
		statusChangeDetails("ticket", oldStatus, input.Status, reason), c.ClientIP(), c.Request.UserAgent())

	database.DB.First(&ticket, id)
	c.JSON(http.StatusOK, gin.H{"message": "Status updated successfully", "ticket": ticket})
}

// AssignTicket assigns a ticket to a user
func AssignTicket(c *gin.Context) {
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
	if assignee.Role == "admin" || assignee.Role == "super_admin" {
		c.JSON(http.StatusBadRequest, gin.H{"error": assignee.Name + " is an admin — admins assign work to staff and supervisors and can't be assigned it themselves"})
		return
	}
	if assignee.Status != "active" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "That user is deactivated and can't be assigned work"})
		return
	}

	if !canAssignWork(currentUserRole) {
		target := input.AssignedToID
		if ok, msg := canTransferOwnWork(c, ticket.AssignedToID, &target); !ok {
			if msg == "" {
				msg = "You don't have permission to reassign tickets"
			}
			c.JSON(http.StatusForbidden, gin.H{"error": msg})
			return
		}
	}
	// The assignee must be in the department the ticket is with, and
	// reassigning is for the ticket's handlers (ticket_flow_rules.go). This
	// used to compare the assignee with the ASSIGNER's department — and
	// admins skipped even that — so the raising department could give a
	// ticket that was with another team to its own staff.
	if code, msg := ticketAssignError(c, &ticket, input.AssignedToID, canAssignWork(currentUserRole)); code != 0 {
		c.JSON(code, gin.H{"error": msg})
		return
	}
	previous := assigneeLabel(ticket.AssignedToID)

	// No first_response_at here: routing a ticket to someone isn't a
	// response to the customer (see CreateTicket).
	updates := map[string]interface{}{
		"assigned_to_id": input.AssignedToID,
		"assigned_by_id": currentUserID, // who gave it to them
		"status":         "assigned",
	}

	if err := database.DB.Model(&ticket).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to assign ticket"})
		return
	}

	// Previous -> new assignee, by name (spec: "Transferred: previous -> new
	// assignee").
	utils.LogAuditWithValues(currentUserID, "assigned", "ticket", ticket.ID,
		map[string]interface{}{"assignee": previous}, map[string]interface{}{"assignee": assignee.Name},
		fmt.Sprintf("Ticket %s assigned: %s -> %s", ticket.TicketNumber, previous, assignee.Name),
		c.ClientIP(), c.Request.UserAgent())
	notify(currentUserID, notice{"assignment", "Ticket " + ticket.TicketNumber + " assigned to you",
		fmt.Sprintf("%s assigned you %s: %s", actorName(currentUserID), ticket.TicketNumber, ticket.Title),
		"ticket", ticket.ID}, input.AssignedToID)

	database.DB.Preload("AssignedTo", userCard).Preload("AssignedBy", userBasics).First(&ticket, id)
	c.JSON(http.StatusOK, gin.H{"message": "Ticket assigned successfully", "ticket": ticket})
}

// validGenericTicketStatus lists the statuses PUT /tickets/:id may set — the
// same set UpdateTicketStatus accepts. "escalated" is deliberately absent
// (escalation is its own action with a required reason) and so is "archived".
func validGenericTicketStatus(s string) bool { return isValidStatus("ticket", s) }

// applyTicketStatusSideEffects sets the timestamps a status change implies,
// by catalog category so renamed / added statuses behave the same:
//   - first response: moving into active work or to resolved (not merely
//     assigned — see CreateTicket)
//   - "resolved" stamps resolved_at, "closed" stamps closed_at
//   - "reopened" clears both, since the ticket is open again
func applyTicketStatusSideEffects(ticket *models.Ticket, status string, updates map[string]interface{}) {
	now := time.Now()
	cat := statusCategory("ticket", status)
	applySLATracking(ticket, status, updates, now)
	if status == "reopened" {
		// The client says it isn't fixed: a fresh SLA clock and escalation
		// chain for the renewed work.
		updates["sla_deadline"] = now.Add(time.Duration(slaMinutesForPriority(ticket.Priority)) * time.Minute)
		updates["auto_escalation_step"] = 0
	}
	switch status {
	case "resolved":
		updates["resolved_at"] = now
	case "closed":
		updates["closed_at"] = now
	case "reopened":
		updates["resolved_at"] = nil
		updates["closed_at"] = nil
	}
	if ticket.FirstResponseAt == nil && status != "reopened" && (cat == "active" || status == "resolved") {
		updates["first_response_at"] = now
	}
}

// isFinishedTicketStatus: done, cancelled or archived.
func isFinishedTicketStatus(status string) bool {
	if status == "archived" {
		return true
	}
	cat := statusCategory("ticket", status)
	return cat == "done" || cat == "cancelled"
}
