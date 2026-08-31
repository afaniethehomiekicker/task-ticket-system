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

	// Use input status if provided, otherwise default to "new" to match Kanban board columns
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
		AssigneeID:   input.AssigneeID, // Pass pointer directly; nil writes NULL to PostgreSQL
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

// Update ticket status or escalate/reassign
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
