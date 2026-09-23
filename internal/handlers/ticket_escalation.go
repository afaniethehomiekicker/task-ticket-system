package handlers

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/middleware"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PATCH /api/tickets/:id/escalate   body: { "level": "l2", "reason": "..." }
//
// Manual escalation, as sent by the frontend's escalateTicket(). Records the
// tier, who, when and why. The ticket's Status is left alone: the UI's status
// badge and filters only know the real Ticket.Status values, and escalation is
// a separate attribute (escalation_level != "none"). It does NOT implement the
// spec's automatic SLA-breach escalation chain — that needs a background job.

// Tier names like l1, l2, l3, management. Kept permissive on purpose (the
// frontend doesn't constrain them) but restricted to a safe character set.
var escalationLevelRe = regexp.MustCompile(`^[a-z0-9_-]{1,30}$`)

func EscalateTicket(c *gin.Context) {
	userIDVal, _ := c.Get("user_id")
	roleVal, _ := c.Get("user_role")
	userID, _ := userIDVal.(uint)
	role, _ := roleVal.(string)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	var ticket models.Ticket
	if err := database.DB.First(&ticket, c.Param("id")).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch ticket"})
		return
	}
	if !userCanAccessTicket(c, &ticket) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: ticket belongs to different department"})
		return
	}
	// "Escalate Incident Tickets" in the matrix — or being the ticket's own
	// assignee, which is what the frontend's canEscalateTicket() also allows.
	isAssignee := ticket.AssignedToID != nil && *ticket.AssignedToID == userID
	if !isAssignee && !middleware.HasPermission(role, "escalate_tickets") {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to escalate tickets"})
		return
	}

	var input struct {
		Level  string `json:"level" binding:"required"`
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	level := strings.ToLower(strings.TrimSpace(input.Level))
	reason := strings.TrimSpace(input.Reason)
	if !escalationLevelRe.MatchString(level) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid escalation level"})
		return
	}
	if reason == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A reason is required to escalate a ticket"})
		return
	}

	switch ticket.Status {
	case "closed", "cancelled", "archived":
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Cannot escalate a ticket with status %q", ticket.Status)})
		return
	}

	if !ticketHasColumn("escalation_level") {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Escalation isn't available yet: the tickets table has no escalation columns (restart the server so AutoMigrate adds them)"})
		return
	}

	oldLevel := ticket.EscalationLevel
	if oldLevel == "" {
		oldLevel = "none"
	}
	now := time.Now()
	updates := map[string]interface{}{"escalation_level": level}
	if ticketHasColumn("escalation_reason") {
		updates["escalation_reason"] = reason
	}
	if ticketHasColumn("escalated_at") {
		updates["escalated_at"] = now
	}
	if ticketHasColumn("escalated_by_id") {
		updates["escalated_by_id"] = userID
	}

	if err := database.DB.Model(&ticket).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to escalate ticket"})
		return
	}

	utils.LogAuditWithValues(userID, "escalated", "ticket", ticket.ID,
		map[string]string{"escalation_level": oldLevel},
		map[string]string{"escalation_level": level, "escalation_reason": reason},
		fmt.Sprintf("Escalated ticket %s from %s to %s. Reason: %s",
			ticket.TicketNumber, strings.ToUpper(oldLevel), strings.ToUpper(level), reason),
		c.ClientIP(), c.Request.UserAgent())

	database.DB.
		Preload("Client").
		Preload("Project").
		Preload("AssignedTo").
		Preload("CreatedBy").
		First(&ticket, ticket.ID)

	c.JSON(http.StatusOK, gin.H{"message": "Ticket escalated", "ticket": ticket})
}
