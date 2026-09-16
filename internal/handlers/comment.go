package handlers

import (
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

type CreateCommentInput struct {
	Content    string `json:"content" binding:"required"`
	UserID     uint   `json:"user_id" binding:"required"`
	TaskID     *uint  `json:"task_id"`
	TicketID   *uint  `json:"ticket_id"`
	IsInternal bool   `json:"is_internal"`
}

// Add a comment to a task or ticket
func CreateComment(c *gin.Context) {
	var input CreateCommentInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Ensure comment is attached to either a task or a ticket, not neither
	if input.TaskID == nil && input.TicketID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Comment must be attached to either a task_id or ticket_id"})
		return
	}

	comment := models.Comment{
		Content:    input.Content,
		UserID:     input.UserID,
		TaskID:     input.TaskID,
		TicketID:   input.TicketID,
		IsInternal: input.IsInternal,
	}

	if result := database.DB.Create(&comment); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create comment"})
		return
	}

	database.DB.Preload("User").First(&comment, comment.ID)

	c.JSON(http.StatusCreated, gin.H{
		"message": "Comment added successfully",
		"comment": comment,
	})
}

// Get comments by task_id or ticket_id
func GetComments(c *gin.Context) {
	taskID := c.Query("task_id")
	ticketID := c.Query("ticket_id")

	query := database.DB.Preload("User")
	if taskID != "" {
		query = query.Where("task_id = ?", taskID)
	} else if ticketID != "" {
		query = query.Where("ticket_id = ?", ticketID)
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Provide either task_id or ticket_id query parameter"})
		return
	}

	var comments []models.Comment
	if result := query.Find(&comments); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch comments"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"comments": comments})
}
