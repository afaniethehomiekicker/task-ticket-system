package handlers

import (
	"fmt"
	"net/http"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

type CreateTicketInput struct {
	TicketNumber string `json:"ticket_number"`
	Title        string `json:"title" binding:"required"`
	Description  string `json:"description"`
	Department   string `json:"department"`
	Category     string `json:"category"`
	Priority     string `json:"priority"`
	Severity     string `json:"severity"`
	Status       string `json:"status"`

	RequesterName    string `json:"requester_name"`
	RequesterEmail   string `json:"requester_email"`
	RequesterCompany string `json:"requester_company"`

	ProjectID    *uint `json:"project_id"`
	AssignedToID *uint `json:"assigned_to_id"`

	DueDate string `json:"due_date"`

	ResponseSlaMinutes   int    `json:"response_sla_minutes"`
	ResolutionSlaMinutes int    `json:"resolution_sla_minutes"`
	Labels               string `json:"labels"`
}

type UpdateTicketStatusInput struct {
	Status            string `json:"status" binding:"required"`
	ResolutionSummary string `json:"resolution_summary"`
}

type EscalateTicketInput struct {
	Level  string `json:"level"`
	Reason string `json:"reason"`
}

// isTicketOpenStatus reports whether a status counts as "still needs
// resolving" for breach purposes — resolved/closed tickets are never
// breached regardless of how late they were, since the clock that
// matters stopped the moment they were actually handled.
func isTicketOpenStatus(status string) bool {
	return status != "resolved" && status != "closed"
}

// computeBreached derives Ticket.Breached fresh from DueDate + Status —
// see the Breached field comment in models.go for why this is virtual
// rather than a stored, separately-updatable column. DueDate is stored as
// a plain string (matching the frontend's ISO-string convention
// elsewhere); an unparseable or empty DueDate is treated as "no SLA
// deadline set" rather than crashing or defaulting to breached.
func computeBreached(t *models.Ticket) bool {
	if t.DueDate == "" || !isTicketOpenStatus(t.Status) {
		return false
	}
	due, err := time.Parse(time.RFC3339, t.DueDate)
	if err != nil {
		return false
	}
	return time.Now().After(due)
}

// GetTickets fetches all tickets from DB
func GetTickets(c *gin.Context) {
	var tickets []models.Ticket
	if result := database.DB.Preload("AssignedTo").Preload("Project").Find(&tickets); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch tickets: " + result.Error.Error()})
		return
	}
	for i := range tickets {
		tickets[i].Breached = computeBreached(&tickets[i])
	}
	c.JSON(http.StatusOK, gin.H{"tickets": tickets})
}

// CreateTicket creates a new ticket safely with a unique ticket number.
//
// Status/priority defaults are lowercase ("open"/"normal") to match the
// values every other status/priority field in this system uses.
func CreateTicket(c *gin.Context) {
	var input CreateTicketInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ticketNum := input.TicketNumber
	if ticketNum == "" {
		ticketNum = fmt.Sprintf("TCK-%d", time.Now().UnixNano()%1000000)
	}

	ticket := models.Ticket{
		TicketNumber:         ticketNum,
		Title:                input.Title,
		Description:          input.Description,
		Department:           input.Department,
		Category:             input.Category,
		Priority:             input.Priority,
		Severity:             input.Severity,
		Status:               input.Status,
		RequesterName:        input.RequesterName,
		RequesterEmail:       input.RequesterEmail,
		RequesterCompany:     input.RequesterCompany,
		ProjectID:            input.ProjectID,
		AssignedToID:         input.AssignedToID,
		DueDate:              input.DueDate,
		ResponseSlaMinutes:   input.ResponseSlaMinutes,
		ResolutionSlaMinutes: input.ResolutionSlaMinutes,
		Labels:               input.Labels,
		EscalationLevel:      "none",
	}

	if ticket.Priority == "" {
		ticket.Priority = "normal"
	}
	if ticket.Status == "" {
		ticket.Status = "open"
	}

	if result := database.DB.Omit("AssignedTo", "Project").Create(&ticket); result.Error != nil {
		// Fallback to timestamp-based unique ticket number if conflict occurs
		ticket.TicketNumber = fmt.Sprintf("TCK-%d", time.Now().UnixNano()%1000000)
		if retryErr := database.DB.Omit("AssignedTo", "Project").Create(&ticket).Error; retryErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": retryErr.Error()})
			return
		}
	}

	ticket.Breached = computeBreached(&ticket)
	c.JSON(http.StatusCreated, gin.H{"message": "Ticket created successfully", "ticket": ticket})
}

// UpdateTicket updates an existing ticket. Returns 404 if the id doesn't
// exist rather than fabricating a placeholder row — see the git history
// on this file for why that used to be a serious bug.
func UpdateTicket(c *gin.Context) {
	idParam := c.Param("id")

	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Normalize every frontend camelCase JSON key this model now has to
	// its database snake_case column name. GORM's map-based Updates()
	// needs the actual column name — passing the camelCase key silently
	// no-ops on that field instead of erroring, so a growing list of
	// unnormalized fields is a growing list of silent no-ops.
	camelToSnake := map[string]string{
		"assignedToId":         "assigned_to_id",
		"ticketNumber":         "ticket_number",
		"resolutionSummary":    "resolution_summary",
		"requesterName":        "requester_name",
		"requesterEmail":       "requester_email",
		"requesterCompany":     "requester_company",
		"projectId":            "project_id",
		"dueDate":              "due_date",
		"responseSlaMinutes":   "response_sla_minutes",
		"resolutionSlaMinutes": "resolution_sla_minutes",
		"firstResponseAt":      "first_response_at",
		"escalationLevel":      "escalation_level",
		"escalationReason":     "escalation_reason",
		"resolvedAt":           "resolved_at",
		"closedAt":             "closed_at",
		"isPinned":             "is_pinned",
	}
	for camelKey, snakeKey := range camelToSnake {
		if val, ok := input[camelKey]; ok {
			input[snakeKey] = val
			delete(input, camelKey)
		}
	}

	var ticket models.Ticket
	if err := database.DB.First(&ticket, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}

	database.DB.Model(&ticket).Omit("AssignedTo", "Project").Updates(input)

	// Fetch fresh updated record from database
	database.DB.Preload("AssignedTo").Preload("Project").First(&ticket, idParam)

	ticket.Breached = computeBreached(&ticket)
	c.JSON(http.StatusOK, gin.H{"message": "Ticket updated successfully", "ticket": ticket})
}

// UpdateTicketStatus updates the status of an existing ticket, and — to
// match the frontend's own updateTicketStatus logic — stamps
// ResolvedAt/ClosedAt the first time a ticket reaches that status.
func UpdateTicketStatus(c *gin.Context) {
	idParam := c.Param("id")

	var input UpdateTicketStatusInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var ticket models.Ticket
	if err := database.DB.First(&ticket, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}

	now := time.Now()
	updates := map[string]interface{}{
		"status": input.Status,
	}

	if input.ResolutionSummary != "" {
		updates["resolution_summary"] = input.ResolutionSummary
	}

	if (input.Status == "resolved" || input.Status == "closed") && ticket.ResolvedAt == nil {
		updates["resolved_at"] = now
	}
	if input.Status == "closed" && ticket.ClosedAt == nil {
		updates["closed_at"] = now
	}

	database.DB.Model(&ticket).Updates(updates)
	database.DB.First(&ticket, idParam)

	ticket.Breached = computeBreached(&ticket)
	c.JSON(http.StatusOK, gin.H{"message": "Ticket status updated successfully", "ticket": ticket})
}

// EscalateTicket escalates an existing ticket, now persisting
// EscalationLevel/EscalationReason for real — those fields didn't exist
// on the model before, so this endpoint previously could only change
// Status/Priority and silently discarded the level/reason it was given.
func EscalateTicket(c *gin.Context) {
	idParam := c.Param("id")

	var input EscalateTicketInput
	_ = c.ShouldBindJSON(&input)

	var ticket models.Ticket
	if err := database.DB.First(&ticket, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}

	updates := map[string]interface{}{
		"status":            "escalated",
		"priority":          "critical",
		"escalation_level":  input.Level,
		"escalation_reason": input.Reason,
	}
	database.DB.Model(&ticket).Updates(updates)
	database.DB.First(&ticket, idParam)

	ticket.Breached = computeBreached(&ticket)
	c.JSON(http.StatusOK, gin.H{"message": "Ticket escalated successfully", "ticket": ticket})
}

// DeleteTicket soft deletes ticket
func DeleteTicket(c *gin.Context) {
	idParam := c.Param("id")

	var ticket models.Ticket
	if err := database.DB.First(&ticket, idParam).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Ticket already deleted"})
		return
	}

	database.DB.Delete(&ticket)
	c.JSON(http.StatusOK, gin.H{"message": "Ticket deleted successfully"})
}
