package handlers

import (
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Per-record timeline — spec slide 20, the accountability chain:
// "Ticket Created by CNOC User A -> Assigned to Staff A -> Staff A creates
// Subtask -> assigns to Staff B -> Transferred to L2 -> Returned to CNOC ->
// Closed". Every one of those events is already an audit entry (created,
// assigned / transferred with names, status changes with previous -> new and
// the reason, field edits old -> new, escalations, access grants, archive /
// restore); these endpoints show them on the record itself.
//
//	GET /api/tickets/:id/timeline
//	GET /api/tasks/:id/timeline     (the task and its sub-tasks)
//
// Visible to anyone who can see the record — it's that record's own history,
// so it doesn't need the system-wide audit permission. Internal-note entries
// are left out for people without view_internal_notes. Someone who sees a task
// only through a sub-task assigned to them gets only their sub-task's events.

const timelineLimit = 500

func hideInternal(c *gin.Context, q *gorm.DB) *gorm.DB {
	if canSeeInternalNotes(c) {
		return q
	}
	return q.Where("audit_logs.action <> ?", "internal_note_added")
}

func timelineQuery() *gorm.DB {
	return database.DB.Model(&models.AuditLog{}).
		Preload("User", func(db *gorm.DB) *gorm.DB { return db.Select("id", "name", "role", "avatar") }).
		Order("audit_logs.created_at DESC, audit_logs.id DESC").
		Limit(timelineLimit)
}

func GetTicketTimeline(c *gin.Context) {
	var ticket models.Ticket
	if err := database.DB.First(&ticket, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}
	if !userCanAccessTicket(c, &ticket) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	var entries []models.AuditLog
	q := timelineQuery().Where("audit_logs.resource_type = ? AND audit_logs.resource_id = ?", "ticket", ticket.ID)
	if err := hideInternal(c, q).Find(&entries).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load timeline"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"timeline": entries})
}

func GetTaskTimeline(c *gin.Context) {
	var task models.Task
	if err := database.DB.First(&task, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	me := viewerFrom(c).ID
	full := userCanAccessTask(c, &task)
	if !full && !hasSubtaskAssignedIn(task.ID, me) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Sub-tasks whose events belong on this timeline.
	subQ := database.DB.Model(&models.SubTask{}).Where("task_id = ?", task.ID)
	if !full {
		subQ = subQ.Where("assignee_id = ?", me)
	}
	var subIDs []uint
	subQ.Pluck("id", &subIDs)

	q := timelineQuery()
	switch {
	case full && len(subIDs) > 0:
		q = q.Where("(audit_logs.resource_type = 'task' AND audit_logs.resource_id = ?) OR (audit_logs.resource_type = 'subtask' AND audit_logs.resource_id IN ?)", task.ID, subIDs)
	case full:
		q = q.Where("audit_logs.resource_type = 'task' AND audit_logs.resource_id = ?", task.ID)
	case len(subIDs) > 0:
		q = q.Where("audit_logs.resource_type = 'subtask' AND audit_logs.resource_id IN ?", subIDs)
	default:
		c.JSON(http.StatusOK, gin.H{"timeline": []models.AuditLog{}})
		return
	}

	var entries []models.AuditLog
	if err := hideInternal(c, q).Find(&entries).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load timeline"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"timeline": entries})
}
