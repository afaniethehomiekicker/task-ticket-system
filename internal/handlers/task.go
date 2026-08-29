package handlers

import (
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

type CreateTaskInput struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	Status      string `json:"status"`   // Defaults to "New" if empty
	Priority    string `json:"priority"` // Low, Normal, High, Urgent, Critical
	Labels      string `json:"labels"`
	ProjectID   uint   `json:"project_id" binding:"required"`
	AssigneeID  uint   `json:"assignee_id"`
}

type UpdateTaskStatusInput struct {
	Status string `json:"status" binding:"required"`
}

// Create a new task under a project
func CreateTask(c *gin.Context) {
	var input CreateTaskInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Status == "" {
		input.Status = "New"
	}
	if input.Priority == "" {
		input.Priority = "Normal"
	}

	task := models.Task{
		Title:       input.Title,
		Description: input.Description,
		Status:      input.Status,
		Priority:    input.Priority,
		Labels:      input.Labels,
		ProjectID:   input.ProjectID,
		AssigneeID:  input.AssigneeID,
	}

	if result := database.DB.Create(&task); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create task"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Task created successfully",
		"task":    task,
	})
}

// Get all tasks, with optional project filtering
func GetTasks(c *gin.Context) {
	var tasks []models.Task
	projectID := c.Query("project_id")

	query := database.DB.Preload("Assignee")
	if projectID != "" {
		query = query.Where("project_id = ?", projectID)
	}

	if result := query.Find(&tasks); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch tasks"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"tasks": tasks})
}

// Update task status (for Kanban drag-and-drop movement)
func UpdateTaskStatus(c *gin.Context) {
	id := c.Param("id")
	var input UpdateTaskStatusInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var task models.Task
	if result := database.DB.First(&task, id); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	task.Status = input.Status
	database.DB.Save(&task)

	c.JSON(http.StatusOK, gin.H{
		"message": "Task status updated successfully",
		"task":    task,
	})
}
