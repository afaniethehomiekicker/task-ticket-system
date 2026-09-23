package handlers

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Review workflow for tasks: todo/in_progress -> in_review -> done, with
// a reopen path back to in_progress. Statuses are the ones UpdateTaskStatus
// already accepts (todo, in_progress, in_review, done, ...), so nothing new
// is introduced into the status vocabulary.
//
//   PATCH /api/tasks/:id/submit-review   assignee or supervisor/admin
//   PATCH /api/tasks/:id/approve         supervisor/admin/super_admin
//   PATCH /api/tasks/:id/reopen          supervisor/admin/super_admin (reason required)
//
// Every transition: checks department access (userCanAccessDepartment),
// validates the current status, records old -> new in the audit log, and
// stores any notes as a team comment on the task.

type reviewInput struct {
	Notes string `json:"notes"`
}

// hasTaskRelation reports whether models.Task declares the named GORM
// relation, so handlers can Preload it without erroring if it doesn't.
func hasTaskRelation(name string) bool {
	stmt := &gorm.Statement{DB: database.DB}
	if err := stmt.Parse(&models.Task{}); err != nil || stmt.Schema == nil {
		return false
	}
	_, ok := stmt.Schema.Relationships.Relations[name]
	return ok
}

// taskWithRelations returns a query that preloads everything the frontend's
// normalizeTask reads. The workflow endpoints return the full task and the
// frontend REPLACES its copy with it, so anything not preloaded here
// (sub-tasks, comments, checklists...) would vanish from the UI.
func taskWithRelations() *gorm.DB {
	q := database.DB.
		Preload("Project").
		Preload("Ticket").
		Preload("Assignee").
		Preload("Creator").
		Preload("SubTasks.Assignee").
		Preload("Comments.User").
		Preload("Dependencies")
	if hasTaskRelation("Checklists") {
		q = q.Preload("Checklists")
	}
	return q
}

// setReviewFields records the review state the task drawer keys off:
// review_status == "submitted_for_review" is what makes it show the
// Approve / Reopen panel, and review_notes is the text shown in that banner.
// Written only where the columns exist.
func setReviewFields(updates map[string]interface{}, reviewStatus, notes string) {
	if taskHasColumn("review_status") {
		updates["review_status"] = reviewStatus
	}
	if taskHasColumn("review_notes") {
		updates["review_notes"] = notes
	}
}

// loadWorkflowTask authenticates the caller, loads the task named by :id and
// applies the department privacy check. On any failure it has already
// written the error response and returns ok=false.
func loadWorkflowTask(c *gin.Context) (task models.Task, userID uint, role string, ok bool) {
	userIDVal, _ := c.Get("user_id")
	userRoleVal, _ := c.Get("user_role")
	userID, _ = userIDVal.(uint)
	role, _ = userRoleVal.(string)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	if err := database.DB.First(&task, c.Param("id")).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch task"})
		}
		return
	}
	if !userCanAccessTask(c, &task) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
		return
	}

	ok = true
	return
}

func bindReviewNotes(c *gin.Context) (string, bool) {
	var input reviewInput
	if err := c.ShouldBindJSON(&input); err != nil && err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return "", false
	}
	return strings.TrimSpace(input.Notes), true
}

// applyTransition writes the status change, records the notes as a team
// comment, logs old -> new to the audit trail and returns the reloaded task.
func applyTransition(c *gin.Context, task models.Task, userID uint, updates map[string]interface{}, label, notes string) {
	fromStatus := task.Status

	if err := database.DB.Model(&task).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update task"})
		return
	}

	if notes != "" {
		comment := models.Comment{
			Content:    fmt.Sprintf("[%s] %s", label, notes),
			IsInternal: false,
			UserID:     userID,
			TaskID:     &task.ID,
		}
		if err := database.DB.Create(&comment).Error; err != nil {
			// The transition itself succeeded; don't fail the request over
			// the note, but don't lose the failure silently either.
			log.Printf("workflow: failed to store %q note on task %d: %v", label, task.ID, err)
		}
	}

	notesForLog := notes
	if notesForLog == "" {
		notesForLog = "None"
	}
	utils.LogAuditWithValues(userID, strings.ToLower(strings.ReplaceAll(label, " ", "_")), "task", task.ID,
		statusChange(fromStatus), statusChange(fmt.Sprint(updates["status"])),
		fmt.Sprintf("%s on %s: status %s -> %v. Notes: %s", label, task.TaskNumber, fromStatus, updates["status"], notesForLog),
		c.ClientIP(), c.Request.UserAgent())

	if err := taskWithRelations().First(&task, task.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Task updated but could not be reloaded"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": label + " successful", "task": task})
}

// SubmitTaskForReview moves a task to in_review.
func SubmitTaskForReview(c *gin.Context) {
	task, userID, role, ok := loadWorkflowTask(c)
	if !ok {
		return
	}
	notes, ok := bindReviewNotes(c)
	if !ok {
		return
	}

	isAssignee := task.AssigneeID != nil && *task.AssigneeID == userID
	if !isAssignee && !canApproveWork(role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the assignee or a supervisor/admin can submit this task for review"})
		return
	}
	if task.Status != "todo" && task.Status != "in_progress" {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Cannot submit a task with status %q for review", task.Status)})
		return
	}

	updates := map[string]interface{}{"status": "in_review"}
	setReviewFields(updates, "submitted_for_review", notes)
	applyTransition(c, task, userID, updates, "Submitted for review", notes)
}

// ApproveTask moves an in_review task to done.
func ApproveTask(c *gin.Context) {
	task, userID, role, ok := loadWorkflowTask(c)
	if !ok {
		return
	}
	notes, ok := bindReviewNotes(c)
	if !ok {
		return
	}

	if !canApproveWork(role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to approve work"})
		return
	}
	// Four-eyes rule: nobody but an admin/super admin signs off a task assigned
	// to themselves, so a small team is never blocked.
	if role != "super_admin" && role != "admin" && task.AssigneeID != nil && *task.AssigneeID == userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can't approve a task assigned to you"})
		return
	}
	if task.Status != "in_review" {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Only tasks in review can be approved (current status: %q)", task.Status)})
		return
	}

	updates := map[string]interface{}{"status": "done"}
	// models.Task had no Progress field, so this used to be an UPDATE against
	// a column that didn't exist and Approve failed outright.
	if taskHasColumn("progress") {
		updates["progress"] = 100
	}
	if task.CompletedAt == nil {
		updates["completed_at"] = time.Now()
	}
	setReviewFields(updates, "approved", notes)
	applyTransition(c, task, userID, updates, "Approved", notes)
}

// ReopenTask sends an in_review or done task back to in_progress. A reason is
// required, matching the spec's "comment/reason where required" rule.
func ReopenTask(c *gin.Context) {
	task, userID, role, ok := loadWorkflowTask(c)
	if !ok {
		return
	}
	notes, ok := bindReviewNotes(c)
	if !ok {
		return
	}

	if !canApproveWork(role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to reopen tasks"})
		return
	}
	if notes == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A reason is required to reopen a task"})
		return
	}
	if task.Status != "in_review" && task.Status != "done" {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Only tasks in review or done can be reopened (current status: %q)", task.Status)})
		return
	}

	updates := map[string]interface{}{
		"status":       "in_progress",
		"completed_at": nil,
	}
	setReviewFields(updates, "reopened", notes)
	applyTransition(c, task, userID, updates, "Reopened", notes)
}
