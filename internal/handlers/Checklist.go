package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
)

type CreateChecklistItemInput struct {
	TaskID uint   `json:"task_id" binding:"required"`
	Title  string `json:"title" binding:"required"`
}

// CreateChecklistItem adds a checklist item to an existing task. Rejects
// (400) if the parent task doesn't exist, rather than auto-vivifying a
// placeholder — same discipline as CreateSubTask. Also enforces the same
// department-access rule every other child-resource handler applies, and
// writes an audit entry.
func CreateChecklistItem(c *gin.Context) {
	var input CreateChecklistItemInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	title := strings.TrimSpace(input.Title)
	if title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Checklist item title cannot be empty"})
		return
	}

	callerIDVal, _ := c.Get("user_id")
	callerID, _ := callerIDVal.(uint)

	var parentTask models.Task
	if err := database.DB.First(&parentTask, input.TaskID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Parent task not found"})
		return
	}
	if !userCanAccessTask(c, &parentTask) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
		return
	}

	item := models.ChecklistItem{
		TaskID: input.TaskID,
		Title:  title,
	}

	if result := database.DB.Create(&item); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create checklist item: " + result.Error.Error()})
		return
	}

	utils.LogAudit(callerID, "checklist_item_added", "task", parentTask.ID,
		fmt.Sprintf("Added checklist item %q to task %s", title, parentTask.TaskNumber),
		c.ClientIP(), c.Request.UserAgent())

	c.JSON(http.StatusCreated, gin.H{"message": "Checklist item created successfully", "checklist": item})
}

// ToggleChecklistItem flips a checklist item's completed state, stamping
// (or clearing, if un-checking) CompletedByID/CompletedAt from the
// verified caller identity — then recomputes and PERSISTS the parent
// task's Progress from the checklist completion ratio.
//
// Fixes vs. the previous version:
//   - Read the caller from c.Get("userID"), a key nothing sets (the auth
//     middleware sets "user_id"), so callerID was always 0 and
//     completed_by_id was stamped with 0.
//   - Had no department/privacy check at all — anyone authenticated could
//     toggle any task's checklist.
//   - Ignored the Updates() error and wrote no audit entry.
func ToggleChecklistItem(c *gin.Context) {
	idParam := c.Param("id")

	callerIDVal, _ := c.Get("user_id")
	callerID, _ := callerIDVal.(uint)
	if callerID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	var item models.ChecklistItem
	if err := database.DB.First(&item, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Checklist item not found"})
		return
	}

	var parentTask models.Task
	if err := database.DB.First(&parentTask, item.TaskID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Parent task not found"})
		return
	}
	if !userCanAccessTask(c, &parentTask) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
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

	if err := database.DB.Model(&item).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update checklist item"})
		return
	}

	var allItems []models.ChecklistItem
	database.DB.Where("task_id = ?", item.TaskID).Find(&allItems)
	if len(allItems) > 0 {
		completedCount := 0
		for _, ci := range allItems {
			if ci.Completed {
				completedCount++
			}
		}
		progress := int(float64(completedCount) / float64(len(allItems)) * 100)
		// The tasks table had no progress column until models.Task gained the
		// field, and this Update's error used to be discarded — so progress
		// silently never persisted. Check the column, and report failures.
		if taskHasColumn("progress") {
			if err := database.DB.Model(&models.Task{}).Where("id = ?", item.TaskID).Update("progress", progress).Error; err != nil {
				log.Printf("checklist: failed to persist progress for task %d: %v", item.TaskID, err)
			}
		} else {
			log.Printf("checklist: tasks.progress column missing; progress for task %d not persisted (run migrations_tasks_tickets.sql)", item.TaskID)
		}
	}

	verb := "Checked"
	if !nextCompleted {
		verb = "Unchecked"
	}
	utils.LogAudit(callerID, "checklist_item_toggled", "task", parentTask.ID,
		fmt.Sprintf("%s checklist item %q on task %s", verb, item.Title, parentTask.TaskNumber),
		c.ClientIP(), c.Request.UserAgent())

	database.DB.First(&item, idParam)
	c.JSON(http.StatusOK, gin.H{"message": "Checklist item updated", "checklist": item})
}
