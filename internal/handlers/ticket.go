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
	Priority     string `json:"priority"`
	Status       string `json:"status"`
	AssignedToID *uint  `json:"assigned_to_id"`
}

type UpdateTicketStatusInput struct {
	Status            string `json:"status" binding:"required"`
	ResolutionSummary string `json:"resolution_summary"`
}

type EscalateTicketInput struct {
	Level  string `json:"level"`
	Reason string `json:"reason"`
}

// GetTickets fetches all tickets from DB
func GetTickets(c *gin.Context) {
	var tickets []models.Ticket
	if result := database.DB.Find(&tickets); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch tickets: " + result.Error.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tickets": tickets})
}

// CreateTicket creates a new ticket safely with a unique ticket number.
//
// Status/priority defaults are lowercase ("open"/"normal") to match the
// values every other status/priority field in this system uses (the
// frontend's <select> options, TicketStatusBadge, PriorityBadge, etc. all
// expect lowercase). This previously defaulted to "New"/"Normal" — "New"
// in particular isn't even a status value the frontend recognizes at all.
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
		TicketNumber: ticketNum,
		Title:        input.Title,
		Description:  input.Description,
		Priority:     input.Priority,
		Status:       input.Status,
		AssignedToID: input.AssignedToID,
	}

	if ticket.Priority == "" {
		ticket.Priority = "normal"
	}
	if ticket.Status == "" {
		ticket.Status = "open"
	}

	if result := database.DB.Omit("Assignee", "Project").Create(&ticket); result.Error != nil {
		// Fallback to timestamp-based unique ticket number if conflict occurs
		ticket.TicketNumber = fmt.Sprintf("TCK-%d", time.Now().UnixNano()%1000000)
		if retryErr := database.DB.Omit("Assignee", "Project").Create(&ticket).Error; retryErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": retryErr.Error()})
			return
		}
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Ticket created successfully", "ticket": ticket})
}

// UpdateTicket updates an existing ticket.
//
// This used to silently fabricate a brand-new placeholder ticket — with a
// generic "Ticket <id>" title and the caller-supplied id forced onto it as
// the primary key — whenever the requested id didn't match an existing
// row. That's how "Ticket 1041" / "Ticket 18" style rows ended up in the
// database: the frontend computes a numeric id from its own local ticket
// id scheme, which frequently doesn't correspond to any real row's
// auto-increment primary key, so nearly every update to a ticket that
// only ever existed in frontend seed data quietly created a garbage
// duplicate instead of updating (or correctly failing to find) the real
// one. A PUT to a nonexistent resource should 404, not invent one.
func UpdateTicket(c *gin.Context) {
	idParam := c.Param("id")

	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Normalize frontend camelCase JSON keys to database snake_case columns
	if val, ok := input["assignedToId"]; ok {
		input["assigned_to_id"] = val
		delete(input, "assignedToId")
	}
	if val, ok := input["ticketNumber"]; ok {
		input["ticket_number"] = val
		delete(input, "ticketNumber")
	}
	if val, ok := input["resolutionSummary"]; ok {
		input["resolution_summary"] = val
		delete(input, "resolutionSummary")
	}

	var ticket models.Ticket
	if err := database.DB.First(&ticket, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}

	database.DB.Model(&ticket).Omit("Assignee", "Project").Updates(input)

	// Fetch fresh updated record from database
	database.DB.First(&ticket, idParam)

	c.JSON(http.StatusOK, gin.H{"message": "Ticket updated successfully", "ticket": ticket})
}

// UpdateTicketStatus updates the status of an existing ticket. See
// UpdateTicket above for why this no longer auto-creates a placeholder
// row when the id isn't found.
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

	ticket.Status = input.Status
	database.DB.Model(&ticket).Update("status", input.Status)

	c.JSON(http.StatusOK, gin.H{"message": "Ticket status updated successfully", "ticket": ticket})
}

// EscalateTicket escalates an existing ticket. See UpdateTicket above for
// why this no longer auto-creates a placeholder row when the id isn't
// found.
func EscalateTicket(c *gin.Context) {
	idParam := c.Param("id")

	var input EscalateTicketInput
	_ = c.ShouldBindJSON(&input)

	var ticket models.Ticket
	if err := database.DB.First(&ticket, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}

	ticket.Status = "escalated"
	database.DB.Model(&ticket).Updates(map[string]interface{}{
		"status":   "escalated",
		"priority": "critical",
	})

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
