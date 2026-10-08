package handlers

import (
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// "I'm working on this" markers on tasks, tickets and projects.
//
//	GET    /api/working               every active marker on records the caller can see
//	PUT    /api/working/:type/:id     mark: I'm working on this
//	DELETE /api/working/:type/:id     unmark (only your own marker)
//
// Rules:
//   - A person can be working on several records at once.
//   - Only the task's / ticket's assignee, or a member of the project, can
//     mark it.
//   - Whoever can already see the record sees the marker (the normal task /
//     ticket / project visibility rules, including Private). This adds no
//     visibility of its own.
//   - A marker clears itself when the record is finished (done / resolved /
//     closed / completed), cancelled, archived or deleted, when the person is
//     no longer its assignee / a project member, or when their account is
//     disabled or archived. pruneWorkSessions does this, so every place that
//     reassigns, routes, returns, transfers or closes work is covered without
//     each handler having to remember it.

var workableTypes = map[string]bool{"task": true, "ticket": true, "project": true}

// Statuses that end work, even if the configurable catalog is missing a row.
var finishedStatuses = map[string]map[string]bool{
	"task":    {"done": true, "cancelled": true, "archived": true},
	"ticket":  {"resolved": true, "closed": true, "cancelled": true, "archived": true},
	"project": {"completed": true, "cancelled": true, "archived": true},
}

// workFinished reports whether a record in this status can no longer be
// worked on. Tasks and tickets also honour the status catalog: any status the
// Super Admin put in the "done" or "cancelled" category counts.
func workFinished(entity, status string) bool {
	if finishedStatuses[entity][status] {
		return true
	}
	if entity == "task" || entity == "ticket" {
		cat := statusCategory(entity, status)
		return cat == "done" || cat == "cancelled"
	}
	return false
}

// ---- pruning ------------------------------------------------------------------

const (
	pruneTasksSQL = `DELETE FROM work_sessions ws
		WHERE ws.record_type = 'task' AND NOT EXISTS (
			SELECT 1 FROM tasks t
			WHERE t.id = ws.record_id AND t.deleted_at IS NULL
			  AND t.assignee_id = ws.user_id
			  AND t.status NOT IN ('done', 'cancelled', 'archived')
			  AND t.status NOT IN (SELECT key FROM workflow_statuses WHERE entity = 'task' AND category IN ('done', 'cancelled')))`

	pruneTicketsSQL = `DELETE FROM work_sessions ws
		WHERE ws.record_type = 'ticket' AND NOT EXISTS (
			SELECT 1 FROM tickets t
			WHERE t.id = ws.record_id AND t.deleted_at IS NULL
			  AND t.assigned_to_id = ws.user_id
			  AND t.status NOT IN ('resolved', 'closed', 'cancelled', 'archived')
			  AND t.status NOT IN (SELECT key FROM workflow_statuses WHERE entity = 'ticket' AND category IN ('done', 'cancelled')))`

	pruneProjectsSQL = `DELETE FROM work_sessions ws
		WHERE ws.record_type = 'project' AND NOT EXISTS (
			SELECT 1 FROM projects p
			JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ws.user_id
			WHERE p.id = ws.record_id AND p.deleted_at IS NULL
			  AND p.status NOT IN ('completed', 'cancelled', 'archived'))`

	pruneUsersSQL = `DELETE FROM work_sessions ws
		WHERE NOT EXISTS (
			SELECT 1 FROM users u
			WHERE u.id = ws.user_id AND u.deleted_at IS NULL AND u.status = 'active')`
)

var (
	pruneMu   sync.Mutex
	lastPrune time.Time
)

// pruneWorkSessions removes every marker that no longer holds (see the rules
// at the top). The list is polled by every signed-in browser, so a full prune
// runs at most every few seconds; force skips that wait (used after a
// change by the caller, so they see the result straight away).
func pruneWorkSessions(force bool) {
	pruneMu.Lock()
	if !force && time.Since(lastPrune) < 5*time.Second {
		pruneMu.Unlock()
		return
	}
	lastPrune = time.Now()
	pruneMu.Unlock()

	for _, q := range []string{pruneTasksSQL, pruneTicketsSQL, pruneProjectsSQL, pruneUsersSQL} {
		if err := database.DB.Exec(q).Error; err != nil {
			log.Printf("work sessions: prune failed: %v", err)
		}
	}
}

// ---- list -------------------------------------------------------------------

type workSessionRow struct {
	ID           uint      `json:"id"`
	UserID       uint      `json:"user_id"`
	RecordType   string    `json:"record_type"`
	RecordID     uint      `json:"record_id"`
	StartedAt    time.Time `json:"started_at"`
	RecordNumber string    `json:"record_number"`
	RecordTitle  string    `json:"record_title"`
	RecordStatus string    `json:"record_status"`
	UserName     string    `json:"user_name"`
	UserAvatar   string    `json:"user_avatar"`
}

// Upper bound per record type, so one request can never grow without limit.
const maxWorkSessionsPerType = 5000

// workSessionsQuery joins the markers of one record type to the record and
// the person. The person is aliased "wu" so it can't clash with the "users"
// subqueries inside the visibility clauses.
func workSessionsQuery(recordType, table, numberCol, titleCol string) *gorm.DB {
	avatar := "'' AS user_avatar"
	if userHasAvatarColumn() {
		avatar = "COALESCE(wu.avatar, '') AS user_avatar"
	}
	return database.DB.Table("work_sessions").
		Select("work_sessions.id, work_sessions.user_id, work_sessions.record_type, work_sessions.record_id, work_sessions.started_at, "+
			"COALESCE("+table+"."+numberCol+", '') AS record_number, COALESCE("+table+"."+titleCol+", '') AS record_title, "+
			"COALESCE("+table+".status, '') AS record_status, COALESCE(wu.name, '') AS user_name, "+avatar).
		Joins("JOIN "+table+" ON "+table+".id = work_sessions.record_id AND "+table+".deleted_at IS NULL").
		Joins("JOIN users wu ON wu.id = work_sessions.user_id AND wu.deleted_at IS NULL").
		Where("work_sessions.record_type = ?", recordType).
		Order("work_sessions.started_at DESC").
		Limit(maxWorkSessionsPerType)
}

// GetWorkSessions returns every marker on a task, ticket or project the
// caller can see. Optional ?type=task|ticket|project narrows it to one kind.
func GetWorkSessions(c *gin.Context) {
	pruneWorkSessions(false)
	v := viewerFrom(c)
	only := c.Query("type")
	if only != "" && !workableTypes[only] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown record type"})
		return
	}

	out := make([]workSessionRow, 0)
	if only == "" || only == "task" {
		var rows []workSessionRow
		if err := applyTaskScope(workSessionsQuery("task", "tasks", "task_number", "title"), v).Scan(&rows).Error; err != nil {
			serverError(c, "Failed to load who is working on what", err)
			return
		}
		out = append(out, rows...)
	}
	if only == "" || only == "ticket" {
		var rows []workSessionRow
		if err := applyTicketScope(workSessionsQuery("ticket", "tickets", "ticket_number", "title"), v).Scan(&rows).Error; err != nil {
			serverError(c, "Failed to load who is working on what", err)
			return
		}
		out = append(out, rows...)
	}
	if only == "" || only == "project" {
		var rows []workSessionRow
		if err := applyProjectScope(workSessionsQuery("project", "projects", "code", "title"), v).Scan(&rows).Error; err != nil {
			serverError(c, "Failed to load who is working on what", err)
			return
		}
		out = append(out, rows...)
	}
	c.JSON(http.StatusOK, gin.H{"sessions": out})
}

// ---- start / stop ---------------------------------------------------------------

func workTarget(c *gin.Context) (string, uint, bool) {
	t := c.Param("type")
	if !workableTypes[t] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only tasks, tickets and projects can be marked as being worked on"})
		return "", 0, false
	}
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid id"})
		return "", 0, false
	}
	return t, uint(id), true
}

// canStartWork checks the caller may mark this record. It answers the
// request itself (and returns false) when they can't.
func canStartWork(c *gin.Context, recordType string, id uint) bool {
	v := viewerFrom(c)
	switch recordType {
	case "task":
		var t models.Task
		if err := database.DB.Select("id", "status", "assignee_id").First(&t, id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
			return false
		}
		if t.AssigneeID == nil || *t.AssigneeID != v.ID {
			c.JSON(http.StatusForbidden, gin.H{"error": "Only the task's assignee can mark it as being worked on"})
			return false
		}
		if workFinished("task", t.Status) {
			c.JSON(http.StatusConflict, gin.H{"error": "This task is already finished"})
			return false
		}
	case "ticket":
		var t models.Ticket
		if err := database.DB.Select("id", "status", "assigned_to_id").First(&t, id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
			return false
		}
		if t.AssignedToID == nil || *t.AssignedToID != v.ID {
			c.JSON(http.StatusForbidden, gin.H{"error": "Only the ticket's assignee can mark it as being worked on"})
			return false
		}
		if workFinished("ticket", t.Status) {
			c.JSON(http.StatusConflict, gin.H{"error": "This ticket is already closed"})
			return false
		}
	case "project":
		var p models.Project
		if err := database.DB.Select("id", "status").First(&p, id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
			return false
		}
		var n int64
		database.DB.Table("project_members").Where("project_id = ? AND user_id = ?", id, v.ID).Count(&n)
		if n == 0 {
			c.JSON(http.StatusForbidden, gin.H{"error": "Only members of this project can mark it as being worked on"})
			return false
		}
		if workFinished("project", p.Status) {
			c.JSON(http.StatusConflict, gin.H{"error": "This project is already finished"})
			return false
		}
	}
	return true
}

// StartWorkSession marks the record as being worked on by the caller.
// Marking it again is harmless (the original start time is kept).
func StartWorkSession(c *gin.Context) {
	t, id, ok := workTarget(c)
	if !ok || !canStartWork(c, t, id) {
		return
	}
	ws := models.WorkSession{UserID: viewerFrom(c).ID, RecordType: t, RecordID: id}
	if err := database.DB.Where(ws).Attrs(models.WorkSession{StartedAt: time.Now()}).FirstOrCreate(&ws).Error; err != nil {
		serverError(c, "Failed to mark this as being worked on", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"session": ws})
}

// StopWorkSession removes the caller's own marker. Removing one that isn't
// there is not an error (it may already have cleared itself).
func StopWorkSession(c *gin.Context) {
	t, id, ok := workTarget(c)
	if !ok {
		return
	}
	if err := database.DB.Where("user_id = ? AND record_type = ? AND record_id = ?", viewerFrom(c).ID, t, id).
		Delete(&models.WorkSession{}).Error; err != nil {
		serverError(c, "Failed to clear the marker", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Stopped"})
}
