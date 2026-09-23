package handlers

import (
	"net/http"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
)

// Subtask handlers

// GetSubTasks is registered as tasks.GET("/:id/subtasks", ...) — but
// previously never read c.Param("id") at all, returning every subtask
// in the entire system regardless of which task the URL named. Fixed to
// actually scope by task, and check the parent task's department the
// same way every other child-resource handler in this file now does.
func GetSubTasks(c *gin.Context) {
	taskID := c.Param("id")

	var task models.Task
	if err := database.DB.First(&task, taskID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	if !userCanAccessTask(c, &task) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
		return
	}

	var subTasks []models.SubTask
	database.DB.Where("task_id = ?", taskID).Preload("Assignee").Preload("Task").Find(&subTasks)
	c.JSON(http.StatusOK, gin.H{"subtasks": subTasks})
}

func CreateSubTask(c *gin.Context) {
	userIDVal, _ := c.Get("user_id")
	currentUserID := userIDVal.(uint)

	var input struct {
		Title          string  `json:"title" binding:"required"`
		TaskID         uint    `json:"task_id" binding:"required"`
		AssigneeID     *uint   `json:"assignee_id"`
		Priority       string  `json:"priority"`
		Deadline       string  `json:"deadline"`
		EstimatedHours float64 `json:"estimated_hours"`
		ActualHours    float64 `json:"actual_hours"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var parentTask models.Task
	if err := database.DB.First(&parentTask, input.TaskID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Parent task not found"})
		return
	}
	if !userCanAccessTask(c, &parentTask) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
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

	utils.LogAudit(currentUserID, "created", "subtask", subTask.ID,
		"Created subtask "+subTask.Title, "", "")

	c.JSON(http.StatusCreated, gin.H{"message": "Subtask created successfully", "subtask": subTask})
}

func UpdateSubTask(c *gin.Context) {
	id := c.Param("subtaskId")

	var input struct {
		Title          string  `json:"title"`
		Status         string  `json:"status"`
		Priority       string  `json:"priority"`
		Deadline       string  `json:"deadline"`
		AssigneeID     *uint   `json:"assignee_id"`
		EstimatedHours float64 `json:"estimated_hours"`
		ActualHours    float64 `json:"actual_hours"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var subTask models.SubTask
	if err := database.DB.First(&subTask, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subtask not found"})
		return
	}

	var parentTask models.Task
	if err := database.DB.First(&parentTask, subTask.TaskID).Error; err == nil {
		if !userCanAccessTask(c, &parentTask) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
			return
		}
	}

	updates := map[string]interface{}{}
	if input.Title != "" {
		updates["title"] = input.Title
	}
	if input.Status != "" {
		// "archived" deliberately excluded — only DeleteSubTask's
		// permission-gated path can set it, same rule as every other
		// entity's generic update endpoint.
		if input.Status == "archived" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Use the archive/delete action to archive a subtask"})
			return
		}
		updates["status"] = input.Status
	}
	if input.Priority != "" {
		updates["priority"] = input.Priority
	}
	if input.Deadline != "" {
		updates["deadline"] = input.Deadline
	}
	if input.AssigneeID != nil {
		updates["assignee_id"] = *input.AssigneeID
	}
	if input.EstimatedHours > 0 {
		updates["estimated_hours"] = input.EstimatedHours
	}
	if input.ActualHours > 0 {
		updates["actual_hours"] = input.ActualHours
	}

	if len(updates) > 0 {
		if err := database.DB.Model(&subTask).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update subtask"})
			return
		}
	}

	database.DB.First(&subTask, id)
	c.JSON(http.StatusOK, gin.H{"message": "Subtask updated successfully", "subtask": subTask})
}

func UpdateSubTaskStatus(c *gin.Context) {
	id := c.Param("subtaskId")

	var input struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Previously accepted any string at all with no validation — every
	// other status-only endpoint in this codebase validates against a
	// known list, this is now consistent with that.
	validStatuses := []string{"todo", "in_progress", "done", "cancelled"}
	valid := false
	for _, s := range validStatuses {
		if s == input.Status {
			valid = true
			break
		}
	}
	if !valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid status"})
		return
	}

	var subTask models.SubTask
	if err := database.DB.First(&subTask, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subtask not found"})
		return
	}

	var parentTask models.Task
	if err := database.DB.First(&parentTask, subTask.TaskID).Error; err == nil {
		if !userCanAccessTask(c, &parentTask) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
			return
		}
	}

	if err := database.DB.Model(&subTask).Update("status", input.Status).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	database.DB.First(&subTask, id)
	c.JSON(http.StatusOK, gin.H{"message": "Subtask status updated successfully", "subtask": subTask})
}

// DeleteSubTask archives a subtask — see the matching comment on
// DeleteProject in projects.go for why this replaces GORM soft-delete.
// Restricted to super_admin/admin, matching every other Delete/archive
// handler in this codebase — archiving is treated as a privileged
// action everywhere, not just for the four top-level entities.
func DeleteSubTask(c *gin.Context) {
	id := c.Param("subtaskId")

	userIDVal, _ := c.Get("user_id")
	userRoleVal, _ := c.Get("user_role")
	currentUserID := userIDVal.(uint)
	currentUserRole := userRoleVal.(string)

	var subTask models.SubTask
	if err := database.DB.First(&subTask, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subtask not found"})
		return
	}

	var parentTask models.Task
	if err := database.DB.First(&parentTask, subTask.TaskID).Error; err == nil {
		if !userCanAccessTask(c, &parentTask) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
			return
		}
	}

	if currentUserRole != "super_admin" && currentUserRole != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient permissions to archive subtask"})
		return
	}

	now := time.Now()
	if err := database.DB.Model(&subTask).Updates(map[string]interface{}{
		"status":         "archived",
		"archived_at":    now,
		"archived_by_id": currentUserID,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to archive subtask"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Subtask archived successfully"})
}

// Task dependencies

// AddTaskDependency was registered in routes.go as
// tasks.POST("/:id/dependencies", ...) — a single :id param, no :depId.
// This handler previously read c.Param("depId"), which can never be
// present on that route, so depID was always "" and the endpoint could
// never actually add a dependency. Fixed to read the dependency's task
// id from the request body instead, matching the route as actually
// registered (RemoveTaskDependency's DELETE route DOES have :depId in
// its path, so that one was already correct and is unchanged below).
func AddTaskDependency(c *gin.Context) {
	id := c.Param("id")

	var input struct {
		DependsOnTaskID uint `json:"depends_on_task_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var task, depTask models.Task
	if err := database.DB.First(&task, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	if !userCanAccessTask(c, &task) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
		return
	}
	if err := database.DB.First(&depTask, input.DependsOnTaskID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dependency task not found"})
		return
	}

	if input.DependsOnTaskID == task.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A task cannot depend on itself"})
		return
	}

	if err := database.DB.Model(&task).Association("Dependencies").Append(&depTask); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add dependency"})
		return
	}

	database.DB.Preload("Dependencies").First(&task, id)
	c.JSON(http.StatusOK, gin.H{"message": "Dependency added successfully", "task": task})
}

func RemoveTaskDependency(c *gin.Context) {
	id := c.Param("id")
	depID := c.Param("depId")

	var task, depTask models.Task
	if err := database.DB.First(&task, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	if !userCanAccessTask(c, &task) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
		return
	}
	if err := database.DB.First(&depTask, depID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Dependency task not found"})
		return
	}

	database.DB.Model(&task).Association("Dependencies").Delete(&depTask)

	database.DB.Preload("Dependencies").First(&task, id)
	c.JSON(http.StatusOK, gin.H{"message": "Dependency removed successfully", "task": task})
}

// Task comments
func GetTaskComments(c *gin.Context) {
	taskID := c.Param("id")

	var task models.Task
	if err := database.DB.First(&task, taskID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	if !userCanAccessTask(c, &task) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
		return
	}

	var comments []models.Comment
	database.DB.Where("task_id = ?", taskID).
		Preload("User").
		Order("created_at asc").
		Find(&comments)

	c.JSON(http.StatusOK, gin.H{"comments": comments})
}

func AddTaskComment(c *gin.Context) {
	taskID := c.Param("id")

	userIDVal, _ := c.Get("user_id")
	currentUserID := userIDVal.(uint)

	var input struct {
		Content    string `json:"content" binding:"required"`
		IsInternal bool   `json:"is_internal"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var task models.Task
	if err := database.DB.First(&task, taskID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	if !userCanAccessTask(c, &task) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
		return
	}

	comment := models.Comment{
		Content:    input.Content,
		IsInternal: input.IsInternal,
		UserID:     currentUserID,
		TaskID:     &task.ID,
	}

	if err := database.DB.Create(&comment).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add comment"})
		return
	}

	database.DB.Preload("User").First(&comment, comment.ID)

	utils.LogAudit(currentUserID, "commented", "task", task.ID,
		"Added comment to task "+task.TaskNumber, "", "")

	c.JSON(http.StatusCreated, gin.H{"message": "Comment added", "comment": comment})
}

// Task work logs
func GetTaskWorkLogs(c *gin.Context) {
	taskID := c.Param("id")

	var task models.Task
	if err := database.DB.First(&task, taskID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	if !userCanAccessTask(c, &task) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
		return
	}

	var workLogs []models.WorkLog
	database.DB.Where("task_id = ?", taskID).
		Preload("User").
		Order("date desc").
		Find(&workLogs)

	c.JSON(http.StatusOK, gin.H{"work_logs": workLogs})
}

func AddTaskWorkLog(c *gin.Context) {
	taskID := c.Param("id")

	userIDVal, _ := c.Get("user_id")
	currentUserID := userIDVal.(uint)

	var input struct {
		Hours       float64   `json:"hours" binding:"required,min=0"`
		Date        time.Time `json:"date" binding:"required"`
		Description string    `json:"description"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var task models.Task
	if err := database.DB.First(&task, taskID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	if !userCanAccessTask(c, &task) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
		return
	}

	workLog := models.WorkLog{
		UserID:      currentUserID,
		TaskID:      &task.ID,
		Hours:       input.Hours,
		Date:        input.Date,
		Description: input.Description,
	}

	if err := database.DB.Create(&workLog).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add work log"})
		return
	}

	database.DB.Preload("User").First(&workLog, workLog.ID)

	utils.LogAudit(currentUserID, "work_log_added", "task", task.ID,
		"Added work log to task "+task.TaskNumber, "", "")

	c.JSON(http.StatusCreated, gin.H{"message": "Work log added", "work_log": workLog})
}
