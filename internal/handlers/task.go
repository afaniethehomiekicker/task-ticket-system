package handlers

import (
	"fmt"
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

type CreateTaskInput struct {
	TaskNumber  string `json:"task_number"`
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	Department  string `json:"department"`
	Status      string `json:"status"`
	Priority    string `json:"priority"`
	Labels      string `json:"labels"`

	ProjectID  *uint `json:"project_id"`
	AssigneeID *uint `json:"assignee_id"`
	CreatorID  *uint `json:"creator_id"`

	StartDate      string  `json:"start_date"`
	DueDate        string  `json:"due_date"`
	EstimatedHours float64 `json:"estimated_hours"`
}

type UpdateTaskStatusInput struct {
	Status string `json:"status" binding:"required"`
}

// GetTasks fetches all tasks from the database
func GetTasks(c *gin.Context) {
	var tasks []models.Task
	if result := database.DB.
		Preload("Assignee").
		Preload("Creator").
		Preload("Checklists").
		Preload("SubTasks").
		Preload("Comments").
		Preload("Attachments").
		Find(&tasks); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch tasks"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tasks": tasks})
}

// CreateTask creates a new task record.
//
// ProjectID/AssigneeID are pointers and left nil when not provided —
// unassigned tasks and tasks with no project are both things the frontend
// explicitly supports ("No Project (Unassigned)" in the create form). This
// used to force both to id 1 when zero, which silently attached every
// unassigned task to whatever record happened to have that id (unrelated
// data, or nothing at all once that row is ever deleted — a hard FK
// failure waiting to happen).
func CreateTask(c *gin.Context) {
	var input CreateTaskInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	taskNumber := input.TaskNumber
	if taskNumber == "" {
		var count int64
		database.DB.Model(&models.Task{}).Count(&count)
		taskNumber = fmt.Sprintf("TSK-%d", 101+count)
	}

	task := models.Task{
		TaskNumber:     taskNumber,
		Title:          input.Title,
		Description:    input.Description,
		Department:     input.Department,
		Status:         input.Status,
		Priority:       input.Priority,
		Labels:         input.Labels,
		ProjectID:      input.ProjectID,
		AssigneeID:     input.AssigneeID,
		CreatorID:      input.CreatorID,
		StartDate:      input.StartDate,
		DueDate:        input.DueDate,
		EstimatedHours: input.EstimatedHours,
		ReviewStatus:   "none",
	}

	if task.Status == "" {
		task.Status = "todo" // matches the frontend's own createTask default
	}
	if task.Priority == "" {
		task.Priority = "normal"
	}

	if result := database.DB.Omit("Assignee", "Creator", "Project").Create(&task); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create task: " + result.Error.Error()})
		return
	}

	database.DB.Preload("Assignee").Preload("Creator").First(&task, task.ID)

	c.JSON(http.StatusCreated, gin.H{"message": "Task created successfully", "task": task})
}

// UpdateTask updates an existing task. Returns 404 if the id doesn't
// exist rather than fabricating a placeholder row — the same auto-vivify
// bug already fixed on the project/ticket handlers.
func UpdateTask(c *gin.Context) {
	idParam := c.Param("id")

	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var task models.Task
	if err := database.DB.First(&task, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	// Normalize frontend camelCase keys to snake_case columns. Note:
	// checklists/subTasks/comments/attachments are relations, not columns
	// on Task itself — they're intentionally NOT in this map. Checklists
	// in particular have a model (Checklist) but no dedicated handler/
	// routes yet, so toggling/adding checklist items still only exists in
	// frontend local state today — flagging that as a real, separate gap,
	// not something this generic Updates() call can silently paper over.
	camelToSnake := map[string]string{
		"taskNumber":     "task_number",
		"projectId":      "project_id",
		"assigneeId":     "assignee_id",
		"assignedToId":   "assignee_id", // frontend's task objects use assignedToId; backend column is assignee_id
		"creatorId":      "creator_id",
		"startDate":      "start_date",
		"dueDate":        "due_date",
		"estimatedHours": "estimated_hours",
		"actualHours":    "actual_hours",
		"isPinned":       "is_pinned",
		"reviewStatus":   "review_status",
		"reviewNotes":    "review_notes",
	}
	for camelKey, snakeKey := range camelToSnake {
		if val, ok := input[camelKey]; ok {
			input[snakeKey] = val
			delete(input, camelKey)
		}
	}

	if len(input) > 0 {
		database.DB.Model(&task).Omit("Assignee", "Creator", "Project", "Checklists", "SubTasks", "Comments", "Attachments", "DependsOn").Updates(input)
	}

	database.DB.Preload("Assignee").Preload("Creator").Preload("Checklists").Preload("SubTasks").Preload("Comments").First(&task, idParam)
	c.JSON(http.StatusOK, gin.H{"message": "Task updated successfully", "task": task})
}

// UpdateTaskStatus updates a task's status. Returns 404 if the id doesn't
// exist. Also replicates the frontend's own status-based progress
// heuristic (AppContext.updateTaskStatus) so progress stays consistent
// regardless of whether a change came through the frontend's local state
// update or hits this endpoint directly.
func UpdateTaskStatus(c *gin.Context) {
	idParam := c.Param("id")

	var input UpdateTaskStatusInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var task models.Task
	if err := database.DB.First(&task, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	progress := task.Progress
	switch input.Status {
	case "completed", "closed":
		progress = 100
	case "new", "todo":
		progress = 0
	case "in_progress":
		if progress == 0 {
			progress = 25
		}
	}

	updates := map[string]interface{}{
		"status":   input.Status,
		"progress": progress,
	}

	if err := database.DB.Model(&task).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	database.DB.First(&task, idParam)
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
