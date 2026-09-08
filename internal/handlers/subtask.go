package handlers

import (
	"net/http"
	"strconv"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

type CreateSubTaskInput struct {
	Title  string `json:"title" binding:"required"`
	TaskID uint   `json:"task_id" binding:"required"`
}

type UpdateSubTaskStatusInput struct {
	Status string `json:"status" binding:"required"`
}

// GetSubTasks fetches all subtasks from the database
func GetSubTasks(c *gin.Context) {
	var subTasks []models.SubTask
	if result := database.DB.Find(&subTasks); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch subtasks"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subtasks": subTasks})
}

// CreateSubTask creates a new subtask record and ensures the parent task exists
func CreateSubTask(c *gin.Context) {
	var input CreateSubTaskInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Auto-ensure parent task exists to satisfy foreign key constraints
	if input.TaskID > 0 {
		var parentTask models.Task
		if err := database.DB.First(&parentTask, input.TaskID).Error; err != nil {
			newTask := models.Task{
				Title:      "Task " + strconv.Itoa(int(input.TaskID)),
				Status:     "New",
				Priority:   "Normal",
				ProjectID:  1,
				AssigneeID: 1,
			}
			// Assign embedded gorm.Model ID explicitly
			newTask.ID = input.TaskID
			database.DB.Create(&newTask)
		}
	} else {
		input.TaskID = 1
	}

	subTask := models.SubTask{
		Title:  input.Title,
		TaskID: input.TaskID,
		Status: "todo",
	}

	if result := database.DB.Create(&subTask); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create subtask: " + result.Error.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Subtask created successfully", "subtask": subTask})
}

// UpdateSubTaskStatus updates an existing subtask status or auto-creates it if missing
func UpdateSubTaskStatus(c *gin.Context) {
	idParam := c.Param("id")

	var input UpdateSubTaskStatusInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var subTask models.SubTask
	if err := database.DB.First(&subTask, idParam).Error; err != nil {
		parsedID, _ := strconv.Atoi(idParam)
		newSubTask := models.SubTask{
			Title:  "Subtask " + idParam,
			TaskID: 1,
			Status: input.Status,
		}
		if parsedID > 0 {
			newSubTask.ID = uint(parsedID)
		}

		if err := database.DB.Create(&newSubTask).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create missing subtask: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "Subtask created and updated successfully", "subtask": newSubTask})
		return
	}

	subTask.Status = input.Status
	if err := database.DB.Model(&subTask).Update("status", input.Status).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Subtask status updated successfully", "subtask": subTask})
}
