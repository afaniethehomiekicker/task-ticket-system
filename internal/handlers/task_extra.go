package handlers

import (
	"fmt"
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
	full := userCanViewTask(c, &task) // read: department viewers see all subtasks
	me := viewerFrom(c).ID
	if !full && !hasSubtaskAssignedIn(task.ID, me) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
		return
	}

	var subTasks []models.SubTask
	q := database.DB.Where("task_id = ?", taskID).Preload("Assignee").Preload("AssignedBy", userBasics)
	if full {
		q = q.Preload("Task")
	} else {
		// Subtask assignee: only their own subtasks, without the parent task
		// embedded in each one.
		q = q.Where("assignee_id = ? AND status <> ?", me, "archived")
	}
	q.Find(&subTasks)
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

	// Handing a sub-task to someone else needs the same permission as
	// reassigning tasks (assign_tickets); assigning it to yourself doesn't.
	if input.AssigneeID != nil && *input.AssigneeID == 0 {
		input.AssigneeID = nil
	}
	if input.AssigneeID != nil && *input.AssigneeID != currentUserID && !canAssignWork(viewerFrom(c).Role) {
		// The task's assignee may split work out to a colleague in their own
		// department (spec slide 20: "Staff A creates Subtask -> assigns to
		// Staff B").
		if ok, msg := canTransferOwnWork(c, parentTask.AssigneeID, input.AssigneeID); !ok {
			if msg == "" {
				msg = "You don't have permission to assign sub-tasks to other people"
			}
			c.JSON(http.StatusForbidden, gin.H{"error": msg})
			return
		}
	}
	if msg := taskAssigneeRoleError(input.AssigneeID); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if msg := assigneeError(input.AssigneeID); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	priority := input.Priority
	if priority == "" {
		priority = "normal"
	}

	subTask := models.SubTask{
		Title:      input.Title,
		TaskID:     input.TaskID,
		AssigneeID: input.AssigneeID,
		AssignedByID: func() *uint {
			if input.AssigneeID != nil {
				return &currentUserID
			}
			return nil
		}(),
		Status:         "todo",
		Priority:       priority,
		Deadline:       input.Deadline,
		EstimatedHours: input.EstimatedHours,
		ActualHours:    input.ActualHours,
	}

	if result := database.DB.Omit("Assignee").Create(&subTask); result.Error != nil {
		serverError(c, "Failed to create subtask", result.Error)
		return
	}

	database.DB.Preload("Assignee").Preload("AssignedBy", userBasics).First(&subTask, subTask.ID)

	utils.LogAudit(currentUserID, "created", "subtask", subTask.ID,
		"Created subtask "+subTask.Title, "", "")
	if subTask.AssigneeID != nil {
		notify(currentUserID, notice{"assignment", "New sub-task: " + subTask.SubtaskNumber,
			fmt.Sprintf("%s gave you sub-task %q of %s", actorName(currentUserID), subTask.Title, parentTask.TaskNumber),
			"task", parentTask.ID}, *subTask.AssigneeID)
	}

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

	// Full edit (title, assignee, deadline...) needs full access to the parent
	// task. The check used to be skipped entirely if the parent couldn't be
	// loaded. A subtask assignee changes status via UpdateSubTaskStatus.
	var parentTask models.Task
	if err := database.DB.First(&parentTask, subTask.TaskID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Parent task not found"})
		return
	}
	if !userCanAccessTask(c, &parentTask) {
		// The sub-task's own assignee (who may only have the reference view
		// of the parent) can still TRANSFER it — nothing else.
		isOwn := subTask.AssigneeID != nil && *subTask.AssigneeID == viewerFrom(c).ID
		onlyTransfer := input.AssigneeID != nil && input.Title == "" && input.Status == "" &&
			input.Priority == "" && input.Deadline == "" && input.EstimatedHours == 0 && input.ActualHours == 0
		if !isOwn || !onlyTransfer {
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
	// Reassigning: 0 clears the assignee (a JSON null can't be told apart
	// from "not sent"). Needs the "Reassign Tickets & Tasks" permission, same
	// as reassigning a task; logged below with old -> new.
	var assigneeChange *[2]string
	if input.AssigneeID != nil {
		var newID *uint
		if *input.AssigneeID != 0 {
			newID = input.AssigneeID
		}
		changing := (subTask.AssigneeID == nil) != (newID == nil) ||
			(subTask.AssigneeID != nil && newID != nil && *subTask.AssigneeID != *newID)
		if changing {
			if !canAssignWork(viewerFrom(c).Role) {
				// Without the general reassign permission: the sub-task's own
				// assignee, or the parent task's assignee, may pass it to a
				// colleague in their own department.
				ok, msg := canTransferOwnWork(c, subTask.AssigneeID, newID)
				if !ok {
					ok2, msg2 := canTransferOwnWork(c, parentTask.AssigneeID, newID)
					ok = ok2
					if msg2 != "" {
						msg = msg2
					}
				}
				if !ok {
					if msg == "" {
						msg = "You don't have permission to reassign sub-tasks"
					}
					c.JSON(http.StatusForbidden, gin.H{"error": msg})
					return
				}
			}
			if msg := taskAssigneeRoleError(newID); msg != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": msg})
				return
			}
			if msg := assigneeError(newID); msg != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": msg})
				return
			}
			if newID == nil {
				updates["assignee_id"] = nil
				updates["assigned_by_id"] = nil
			} else {
				updates["assignee_id"] = *newID
				updates["assigned_by_id"] = viewerFrom(c).ID // who gave it to them
			}
			assigneeChange = &[2]string{assigneeLabel(subTask.AssigneeID), assigneeLabel(newID)}
		}
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

	if assigneeChange != nil {
		utils.LogAuditWithValues(viewerFrom(c).ID, "assigned", "subtask", subTask.ID,
			map[string]interface{}{"assignee": assigneeChange[0]}, map[string]interface{}{"assignee": assigneeChange[1]},
			fmt.Sprintf("Sub-task %q of %s reassigned: %s -> %s", subTask.Title, parentTask.TaskNumber, assigneeChange[0], assigneeChange[1]),
			c.ClientIP(), c.Request.UserAgent())
		if v, ok := updates["assignee_id"].(uint); ok {
			notify(viewerFrom(c).ID, notice{"assignment", "Sub-task " + subTask.SubtaskNumber + " is now yours",
				fmt.Sprintf("%s gave you sub-task %q of %s", actorName(viewerFrom(c).ID), subTask.Title, parentTask.TaskNumber),
				"task", parentTask.ID}, v)
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

	// Allowed for anyone with full access to the parent task, and for the
	// subtask's own assignee (spec: staff work on the subtask assigned to
	// them). Before, the assignee was refused unless they could also see the
	// whole parent task, and the check was skipped if the parent was missing.
	var parentTask models.Task
	if err := database.DB.First(&parentTask, subTask.TaskID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Parent task not found"})
		return
	}
	isOwnSubtask := subTask.AssigneeID != nil && *subTask.AssigneeID == viewerFrom(c).ID
	if !isOwnSubtask && !userCanAccessTask(c, &parentTask) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
		return
	}
	if subTask.Status == "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This subtask is archived"})
		return
	}
	oldStatus := subTask.Status

	if err := database.DB.Model(&subTask).Update("status", input.Status).Error; err != nil {
		serverError(c, "Something went wrong. Please try again.", err)
		return
	}

	utils.LogAuditWithValues(viewerFrom(c).ID, "status_changed", "subtask", subTask.ID,
		statusChange(oldStatus), statusChange(input.Status),
		fmt.Sprintf("Subtask %q of %s: %s -> %s", subTask.Title, parentTask.TaskNumber, oldStatus, input.Status),
		c.ClientIP(), c.Request.UserAgent())

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
	currentUserID := userIDVal.(uint)

	var subTask models.SubTask
	if err := database.DB.First(&subTask, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subtask not found"})
		return
	}

	var parentTask models.Task
	if err := database.DB.First(&parentTask, subTask.TaskID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Parent task not found"})
		return
	}
	if !userCanAccessTask(c, &parentTask) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// The archive_records matrix permission (see restore.go).
	if !canArchiveRecords(c) {
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
	// The linked task must be one the caller can access, and the link must
	// not close a loop (task_dependencies.go). This used to load the task by
	// id with no check, and the response then returned it in full.
	deps, code, msg := validateDependencies(c, task.ID, []uint{input.DependsOnTaskID}, existingDependencyIDs(task.ID))
	if code != 0 {
		c.JSON(code, gin.H{"error": msg})
		return
	}
	depTask = deps[0]

	if err := database.DB.Model(&task).Association("Dependencies").Append(&depTask); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add dependency"})
		return
	}

	// Full reload — the frontend replaces its task with this response (see
	// reloadFullTask); a Dependencies-only preload blanked its sub-tasks,
	// comments and checklist.
	c.JSON(http.StatusOK, gin.H{"message": "Dependency added successfully", "task": reloadFullTask(c, task)})
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

	if err := database.DB.Model(&task).Association("Dependencies").Delete(&depTask); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove dependency"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Dependency removed successfully", "task": reloadFullTask(c, task)})
}

// Task comments
func GetTaskComments(c *gin.Context) {
	taskID := c.Param("id")

	var task models.Task
	if err := database.DB.First(&task, taskID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	if !userCanViewTask(c, &task) { // read: department viewers too
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
		return
	}

	var comments []models.Comment
	database.DB.Where("task_id = ?", taskID).
		Preload("User", userCard). // name/avatar only
		Order("created_at asc").
		Find(&comments)

	comments = visibleComments(canSeeInternalNotes(c), comments)
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

	// Posting a private management note needs the same permission as reading
	// one (view_internal_notes). Anyone could post them before.
	if input.IsInternal && !canSeeInternalNotes(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to post internal notes"})
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

	// Internal notes get their own action so the timeline can hide them from
	// people who can't see internal notes.
	action, what := "commented", "comment"
	if input.IsInternal {
		action, what = "internal_note_added", "internal note"
	}
	utils.LogAudit(currentUserID, action, "task", task.ID,
		"Added "+what+" to task "+task.TaskNumber, c.ClientIP(), c.Request.UserAgent())

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
	if !userCanViewTask(c, &task) { // read: department viewers too
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

// assigneeLabel renders a user id for audit text: their name, or "unassigned".
func assigneeLabel(id *uint) string {
	if id == nil {
		return "unassigned"
	}
	var u models.User
	if err := database.DB.Select("id", "name").First(&u, *id).Error; err != nil {
		return fmt.Sprintf("user #%d", *id)
	}
	return u.Name
}
