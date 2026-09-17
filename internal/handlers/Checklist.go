package handlers

import (
	"net/http"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

type CreateChecklistItemInput struct {
	TaskID uint   `json:"task_id" binding:"required"`
	Title  string `json:"title" binding:"required"`
}

// CreateChecklistItem adds a checklist item to an existing task. Rejects
// (400) if the parent task doesn't exist, rather than auto-vivifying a
// placeholder — same discipline as CreateSubTask.
func CreateChecklistItem(c *gin.Context) {
	var input CreateChecklistItemInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var parentTask models.Task
	if err := database.DB.First(&parentTask, input.TaskID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Parent task not found"})
		return
	}

	item := models.Checklist{
		TaskID: input.TaskID,
		Title:  input.Title,
	}

	if result := database.DB.Create(&item); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create checklist item: " + result.Error.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Checklist item created successfully", "checklist": item})
}

// ToggleChecklistItem flips a checklist item's completed state, stamping
// (or clearing, if un-checking) CompletedByID/CompletedAt from the
// verified caller identity — then recomputes and PERSISTS the parent
// task's Progress from the checklist completion ratio. This mirrors logic
// that previously only existed as a local-state calculation in the
// frontend: progress shown to a user in one session never actually
// survived a reload, since nothing on the backend tracked checklists at
// all until this endpoint existed.
func ToggleChecklistItem(c *gin.Context) {
	idParam := c.Param("id")

	callerIDRaw, _ := c.Get("userID")
	callerID, _ := callerIDRaw.(uint)

	var item models.Checklist
	if err := database.DB.First(&item, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Checklist item not found"})
		return
	}

	nextCompleted := !item.Completed
	updates := map[string]interface{}{
		"completed": nextCompleted,
	}
	if nextCompleted {
		updates["completed_by_id"] = callerID
		updates["completed_at"] = time.Now()
	} else {
		// Explicit nil, not omitted — a map-based Updates() call applies
		// exactly what's given, including clearing a column to NULL,
		// unlike a struct-based Updates() which skips zero values.
		updates["completed_by_id"] = nil
		updates["completed_at"] = nil
	}

	database.DB.Model(&item).Updates(updates)

	var allItems []models.Checklist
	database.DB.Where("task_id = ?", item.TaskID).Find(&allItems)
	if len(allItems) > 0 {
		completedCount := 0
		for _, ci := range allItems {
			if ci.Completed {
				completedCount++
			}
		}
		progress := int(float64(completedCount) / float64(len(allItems)) * 100)
		database.DB.Model(&models.Task{}).Where("id = ?", item.TaskID).Update("progress", progress)
	}

	database.DB.First(&item, idParam)
	c.JSON(http.StatusOK, gin.H{"message": "Checklist item updated", "checklist": item})
}
