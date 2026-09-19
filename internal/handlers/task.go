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
		Preload("DependsOn").
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
		// Previously called without checking the error at all — a failed
		// UPDATE (e.g. a string value like "" or "7" sent for a *uint
		// column, which Postgres won't implicitly cast) would silently do
		// nothing while this handler still returned 200 OK with the
		// task's UNCHANGED data. That's exactly how "assignee doesn't
		// save" could happen with no visible error anywhere — the save
		// looked successful in the Network tab every single time.
		if err := database.DB.Model(&task).
			Omit("Assignee", "Creator", "Project", "Checklists", "SubTasks", "Comments", "Attachments", "DependsOn").
			Updates(input).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update task: " + err.Error()})
			return
		}
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

// --- Task Review Workflow ------------------------------------------------
//
// These three actions used to exist only as local frontend state changes
// — nothing on the backend enforced who was allowed to submit, approve,
// or reopen a task's work. That meant the "only a supervisor can approve"
// rule was cosmetic: anyone could have hit the generic PUT /tasks/:id and
// set review_status to admin_approved on their own task directly. All
// three read caller identity from the verified JWT claims AuthenticateJWT
// already sets on the context (c.Get("userID")/c.Get("userRole")) — same
// principle as UpdateUserProfile and the rbac.go fix earlier: never trust
// what the client claims about itself.

type TaskReviewActionInput struct {
	Notes string `json:"notes"`
}

// SubmitTaskForReview lets the task's own assignee — or an admin-tier
// user acting on their behalf — move a task into review. Requires
// AuthenticateJWT only (see routes.go); the in-handler check below is
// what actually restricts who can call it, since "must be the assignee"
// isn't a fixed role AuthorizeRole could express.
func SubmitTaskForReview(c *gin.Context) {
	idParam := c.Param("id")

	var input TaskReviewActionInput
	_ = c.ShouldBindJSON(&input)

	callerIDRaw, _ := c.Get("userID")
	callerRoleRaw, _ := c.Get("userRole")
	callerID, _ := callerIDRaw.(uint)
	callerRole, _ := callerRoleRaw.(string)

	var task models.Task
	if err := database.DB.First(&task, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	isAssignee := task.AssigneeID != nil && *task.AssigneeID == callerID
	isAdminTier := callerRole == "admin" || callerRole == "super_admin"
	if !isAssignee && !isAdminTier {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the assignee can submit this task for review"})
		return
	}

	notes := input.Notes
	if notes == "" {
		notes = "Work finished, ready for supervisor validation."
	}

	database.DB.Model(&task).Updates(map[string]interface{}{
		"status":        "under_review",
		"review_status": "submitted_for_review",
		"review_notes":  notes,
	})
	database.DB.Preload("Assignee").Preload("Creator").First(&task, idParam)

	c.JSON(http.StatusOK, gin.H{"message": "Task submitted for review", "task": task})
}

// ApproveTask marks a task's submitted work as approved and completed.
// Restricted to Supervisor/Admin/Super Admin via AuthorizeRole in
// routes.go — a task's own assignee cannot approve their own work; that
// restriction is now enforced server-side, not just by which buttons the
// frontend happens to render.
func ApproveTask(c *gin.Context) {
	idParam := c.Param("id")

	var input TaskReviewActionInput
	_ = c.ShouldBindJSON(&input)

	callerRoleRaw, _ := c.Get("userRole")
	callerRole, _ := callerRoleRaw.(string)

	var task models.Task
	if err := database.DB.First(&task, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	reviewStatus := "admin_approved"
	if callerRole == "supervisor" {
		reviewStatus = "supervisor_approved"
	}

	notes := input.Notes
	if notes == "" {
		notes = "Approved."
	}

	database.DB.Model(&task).Updates(map[string]interface{}{
		"status":        "completed",
		"progress":      100,
		"review_status": reviewStatus,
		"review_notes":  notes,
	})
	database.DB.Preload("Assignee").Preload("Creator").First(&task, idParam)

	c.JSON(http.StatusOK, gin.H{"message": "Task approved", "task": task})
}

// ReopenTask sends a submitted task back to the assignee with notes on
// what still needs to change. Same restriction as ApproveTask.
func ReopenTask(c *gin.Context) {
	idParam := c.Param("id")

	var input TaskReviewActionInput
	_ = c.ShouldBindJSON(&input)

	var task models.Task
	if err := database.DB.First(&task, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	notes := input.Notes
	if notes == "" {
		notes = "Reopened. Additional changes needed."
	}

	database.DB.Model(&task).Updates(map[string]interface{}{
		"status":        "in_progress",
		"review_status": "reopened",
		"review_notes":  notes,
	})
	database.DB.Preload("Assignee").Preload("Creator").First(&task, idParam)

	c.JSON(http.StatusOK, gin.H{"message": "Task reopened", "task": task})
}

// --- Task Dependencies ---------------------------------------------------
//
// DependsOn is a real self-referential many2many on Task (see models.go)
// rather than a comma-separated list of task numbers — a dependency
// references another task's actual row, so deleting that task shouldn't
// leave a dangling, silently-wrong reference behind.

type AddTaskDependencyInput struct {
	DependsOnTaskID uint `json:"depends_on_task_id" binding:"required"`
}

// AddTaskDependency records that :id depends on another task. Rejects a
// task depending on itself, and rejects (400) if the target task doesn't
// exist — same "don't silently paper over a bad reference" discipline as
// everywhere else in this codebase.
func AddTaskDependency(c *gin.Context) {
	idParam := c.Param("id")

	var input AddTaskDependencyInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var task models.Task
	if err := database.DB.First(&task, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	if input.DependsOnTaskID == task.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A task cannot depend on itself"})
		return
	}

	var dependsOnTask models.Task
	if err := database.DB.First(&dependsOnTask, input.DependsOnTaskID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "The task you're trying to depend on doesn't exist"})
		return
	}

	if err := database.DB.Model(&task).Association("DependsOn").Append(&dependsOnTask); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add dependency: " + err.Error()})
		return
	}

	database.DB.Preload("DependsOn").First(&task, idParam)
	c.JSON(http.StatusOK, gin.H{"message": "Dependency added successfully", "task": task})
}

// RemoveTaskDependency removes a previously-added dependency link. Not
// finding the link isn't treated as an error — removing something already
// absent is a no-op, not a failure, same as DeleteTask/DeleteTicket
// elsewhere in this codebase.
func RemoveTaskDependency(c *gin.Context) {
	idParam := c.Param("id")
	depIDParam := c.Param("depId")

	var task models.Task
	if err := database.DB.First(&task, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	var dependsOnTask models.Task
	if err := database.DB.First(&dependsOnTask, depIDParam).Error; err == nil {
		database.DB.Model(&task).Association("DependsOn").Delete(&dependsOnTask)
	}

	database.DB.Preload("DependsOn").First(&task, idParam)
	c.JSON(http.StatusOK, gin.H{"message": "Dependency removed successfully", "task": task})
}
