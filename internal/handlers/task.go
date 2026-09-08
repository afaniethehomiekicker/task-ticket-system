package handlers

import (
	"net/http"
	"strconv"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

type CreateTaskInput struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Priority    string `json:"priority"`
	Labels      string `json:"labels"`
	ProjectID   uint   `json:"project_id"`
	AssigneeID  uint   `json:"assignee_id"`
}

type UpdateTaskStatusInput struct {
	Status string `json:"status" binding:"required"`
}

// GetTasks fetches all tasks from the database
func GetTasks(c *gin.Context) {
	var tasks []models.Task
	if result := database.DB.Find(&tasks); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch tasks"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tasks": tasks})
}

// CreateTask creates a new task record
func CreateTask(c *gin.Context) {
	var input CreateTaskInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
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

	if task.Status == "" {
		task.Status = "New"
	}
	if task.Priority == "" {
		task.Priority = "Normal"
	}
	if task.ProjectID == 0 {
		task.ProjectID = 1
	}
	if task.AssigneeID == 0 {
		task.AssigneeID = 1
	}

	if result := database.DB.Create(&task); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create task: " + result.Error.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Task created successfully", "task": task})
}

// UpdateTask updates an existing task or auto-creates it if missing
func UpdateTask(c *gin.Context) {
	idParam := c.Param("id")

	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var task models.Task
	if err := database.DB.First(&task, idParam).Error; err != nil {
		parsedID, _ := strconv.Atoi(idParam)
		task = models.Task{
			Title:      "Task " + idParam,
			Status:     "New",
			Priority:   "Normal",
			ProjectID:  1,
			AssigneeID: 1,
		}
		if parsedID > 0 {
			task.ID = uint(parsedID)
		}
		database.DB.Create(&task)
	}

	database.DB.Model(&task).Updates(input)
	c.JSON(http.StatusOK, gin.H{"message": "Task updated successfully", "task": task})
}

// UpdateTaskStatus updates task status or auto-creates the record if missing
func UpdateTaskStatus(c *gin.Context) {
	idParam := c.Param("id")

	var input UpdateTaskStatusInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var task models.Task
	if err := database.DB.First(&task, idParam).Error; err != nil {
		parsedID, _ := strconv.Atoi(idParam)
		task = models.Task{
			Title:      "Task " + idParam,
			Status:     input.Status,
			Priority:   "Normal",
			ProjectID:  1,
			AssigneeID: 1,
		}
		if parsedID > 0 {
			task.ID = uint(parsedID)
		}
		if err := database.DB.Create(&task).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to auto-create task: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Task created and status updated", "task": task})
		return
	}

	task.Status = input.Status
	if err := database.DB.Model(&task).Update("status", input.Status).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Task status updated successfully", "task": task})
}

// DeleteTask soft-deletes a task
func DeleteTask(c *gin.Context) {
	idParam := c.Param("id")

	var task models.Task
	if err := database.DB.First(&task, idParam).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Task already removed"})
		return
	}

	database.DB.Delete(&task)
	c.JSON(http.StatusOK, gin.H{"message": "Task deleted successfully"})
}
