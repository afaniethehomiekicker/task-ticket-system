package handlers

import (
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

type CreateSubTaskInput struct {
	Title          string  `json:"title" binding:"required"`
	TaskID         uint    `json:"task_id" binding:"required"`
	AssigneeID     *uint   `json:"assignee_id"`
	Priority       string  `json:"priority"`
	Deadline       string  `json:"deadline"`
	EstimatedHours float64 `json:"estimated_hours"`
	ActualHours    float64 `json:"actual_hours"`
}

type UpdateSubTaskStatusInput struct {
	Status string `json:"status" binding:"required"`
}

// GetSubTasks fetches all subtasks from the database
func GetSubTasks(c *gin.Context) {
	var subTasks []models.SubTask
	if result := database.DB.Preload("Assignee").Find(&subTasks); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch subtasks"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subtasks": subTasks})
}

// CreateSubTask creates a new subtask under an existing parent task.
//
// This used to silently fabricate a fake parent Task (complete with the
// same hardcoded ProjectID/AssigneeID = 1 bug already removed from
// task.go, PLUS a forced, caller-supplied primary key) whenever the
// referenced task_id didn't exist. A subtask creation request naming a
// nonexistent parent is invalid input — it should be rejected, not
// silently patched over by inventing the parent it was missing.
func CreateSubTask(c *gin.Context) {
	var input CreateSubTaskInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var parentTask models.Task
	if err := database.DB.First(&parentTask, input.TaskID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Parent task not found"})
		return
	}

	priority := input.Priority
	if priority == "" {
		priority = "normal"
	}

	subTask := models.SubTask{
		Title:          input.Title,
		TaskID:         input.TaskID,
		AssigneeID:     input.AssigneeID,
		Status:         "todo",
		Priority:       priority,
		Deadline:       input.Deadline,
		EstimatedHours: input.EstimatedHours,
		ActualHours:    input.ActualHours,
	}

	if result := database.DB.Omit("Assignee").Create(&subTask); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create subtask: " + result.Error.Error()})
		return
	}

	database.DB.Preload("Assignee").First(&subTask, subTask.ID)

	c.JSON(http.StatusCreated, gin.H{"message": "Subtask created successfully", "subtask": subTask})
}

// UpdateSubTaskStatus updates an existing subtask's status. Returns 404 if
// the id doesn't exist rather than fabricating a placeholder row (the
// same auto-vivify bug already fixed across every other handler in this
// codebase).
func UpdateSubTaskStatus(c *gin.Context) {
	idParam := c.Param("id")

	var input UpdateSubTaskStatusInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var subTask models.SubTask
	if err := database.DB.First(&subTask, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subtask not found"})
		return
	}

	if err := database.DB.Model(&subTask).Update("status", input.Status).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	database.DB.First(&subTask, idParam)
	c.JSON(http.StatusOK, gin.H{"message": "Subtask status updated successfully", "subtask": subTask})
}
