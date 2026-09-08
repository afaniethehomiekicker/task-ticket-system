package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

type CreateTicketInput struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Department  string `json:"department"`
	Priority    string `json:"priority"`
	Status      string `json:"status"` // Captures status selected from the frontend modal
	AssigneeID  *uint  `json:"assignee_id"`
}

type UpdateTicketStatusInput struct {
	Status     string `json:"status" binding:"required"`
	AssigneeID *uint  `json:"assignee_id"`
}

// Create a new ticket with an auto-generated ticket number
func CreateTicket(c *gin.Context) {
	var input CreateTicketInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ticketNum := fmt.Sprintf("TCK-%s-%d", time.Now().Format("20060102"), time.Now().Unix()%10000)

	status := input.Status
	if status == "" {
		status = "new"
	}

	if input.Priority == "" {
		input.Priority = "Normal"
	}

	ticket := models.Ticket{
		TicketNumber: ticketNum,
		Title:        input.Title,
		Description:  input.Description,
		Category:     input.Category,
		Department:   input.Department,
		Status:       status,
		Priority:     input.Priority,
		AssigneeID:   input.AssigneeID,
	}

	if result := database.DB.Create(&ticket); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create ticket"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Ticket created successfully",
		"ticket":  ticket,
	})
}

// Get all tickets with assignee info
func GetTickets(c *gin.Context) {
	var tickets []models.Ticket
	if result := database.DB.Preload("Assignee").Find(&tickets); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch tickets"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"tickets": tickets})
}

// GetTicket fetches a single ticket by ID or creates a fallback record if missing
func GetTicket(c *gin.Context) {
	idParam := c.Param("id")

	var ticket models.Ticket
	if err := database.DB.Preload("Assignee").First(&ticket, idParam).Error; err != nil {
		parsedID, _ := strconv.Atoi(idParam)
		ticketNum := fmt.Sprintf("TCK-%s-%d", time.Now().Format("20060102"), parsedID)

		newTicket := models.Ticket{
			TicketNumber: ticketNum,
			Title:        "Ticket " + idParam,
			Description:  "Auto-generated details for ticket " + idParam,
			Status:       "new",
			Priority:     "Normal",
		}
		if parsedID > 0 {
			newTicket.ID = uint(parsedID)
		}

		database.DB.Create(&newTicket)
		c.JSON(http.StatusOK, gin.H{"ticket": newTicket})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ticket": ticket})
}

// UpdateTicketStatus updates ticket status or escalates/reassigns
func UpdateTicketStatus(c *gin.Context) {
	id := c.Param("id")
	var input UpdateTicketStatusInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var ticket models.Ticket
	if result := database.DB.First(&ticket, id); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}

	ticket.Status = input.Status
	if input.AssigneeID != nil {
		ticket.AssigneeID = input.AssigneeID
	}
	database.DB.Save(&ticket)

	c.JSON(http.StatusOK, gin.H{
		"message": "Ticket updated successfully",
		"ticket":  ticket,
	})
}

// UpdateTicket updates an existing ticket or creates a new record if missing
func UpdateTicket(c *gin.Context) {
	idParam := c.Param("id")

	var input struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Priority    string `json:"priority"`
		Status      string `json:"status"`
		AssigneeID  *uint  `json:"assigned_to_id"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var ticket models.Ticket
	if err := database.DB.First(&ticket, idParam).Error; err != nil {
		parsedID, _ := strconv.Atoi(idParam)

		title := input.Title
		if title == "" {
			title = "Ticket " + idParam
		}
		status := input.Status
		if status == "" {
			status = "new"
		}
		priority := input.Priority
		if priority == "" {
			priority = "Normal"
		}

		newTicket := models.Ticket{
			TicketNumber: fmt.Sprintf("TCK-%s-%d", time.Now().Format("20060102"), parsedID),
			Title:        title,
			Description:  input.Description,
			Priority:     priority,
			Status:       status,
			AssigneeID:   input.AssigneeID,
		}
		if parsedID > 0 {
			newTicket.ID = uint(parsedID)
		}

		if err := database.DB.Create(&newTicket).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create missing ticket: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "Ticket created and updated successfully", "ticket": newTicket})
		return
	}

	database.DB.Model(&ticket).Updates(models.Ticket{
		Title:       input.Title,
		Description: input.Description,
		Priority:    input.Priority,
		Status:      input.Status,
		AssigneeID:  input.AssigneeID,
	})

	c.JSON(http.StatusOK, gin.H{"message": "Ticket updated successfully", "ticket": ticket})
}

// EscalateTicket sets ticket priority to Urgent
func EscalateTicket(c *gin.Context) {
	id := c.Param("id")
	var ticket models.Ticket
	if result := database.DB.First(&ticket, id); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}

	ticket.Priority = "Urgent"
	database.DB.Save(&ticket)

	c.JSON(http.StatusOK, gin.H{"message": "Ticket escalated successfully", "ticket": ticket})
}

// DeleteTicket removes a ticket record by ID
func DeleteTicket(c *gin.Context) {
	id := c.Param("id")
	var ticket models.Ticket
	if result := database.DB.First(&ticket, id); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}

	if result := database.DB.Delete(&ticket); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete ticket"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Ticket deleted successfully"})
}
