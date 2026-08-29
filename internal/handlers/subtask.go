package handlers

import (
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

type CreateSubTaskInput struct {
	Title      string `json:"title" binding:"required"`
	Status     string `json:"status"` // <-- Add this field
	Priority   string `json:"priority"`
	Deadline   string `json:"deadline"`
	TaskID     uint   `json:"task_id" binding:"required"`
	AssigneeID uint   `json:"assignee_id"`
}

type UpdateSubTaskStatusInput struct {
	Status string `json:"status" binding:"required"`
}

// Create a new sub-task under a parent task
func CreateSubTask(c *gin.Context) {
	var input CreateSubTaskInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Status == "" {
		input.Status = "Pending"
	}
	if input.Priority == "" {
		input.Priority = "Normal"
	}

	subTask := models.SubTask{
		Title:      input.Title,
		Status:     input.Status,
		Priority:   input.Priority,
		Deadline:   input.Deadline,
		TaskID:     input.TaskID,
		AssigneeID: input.AssigneeID,
	}

	if result := database.DB.Create(&subTask); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create sub-task"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":  "Sub-task created successfully",
		"sub_task": subTask,
	})
}

// Get sub-tasks by parent task ID
func GetSubTasks(c *gin.Context) {
	var subTasks []models.SubTask
	taskID := c.Query("task_id")

	query := database.DB
	if taskID != "" {
		query = query.Where("task_id = ?", taskID)
	}

	if result := query.Find(&subTasks); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch sub-tasks"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"sub_tasks": subTasks})
}

// Update sub-task status
func UpdateSubTaskStatus(c *gin.Context) {
	id := c.Param("id")
	var input UpdateSubTaskStatusInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var subTask models.SubTask
	if result := database.DB.First(&subTask, id); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Sub-task not found"})
		return
	}

	subTask.Status = input.Status
	database.DB.Save(&subTask)

	c.JSON(http.StatusOK, gin.H{
		"message":  "Sub-task status updated successfully",
		"sub_task": subTask,
	})
}
