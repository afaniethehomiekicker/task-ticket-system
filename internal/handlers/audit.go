package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// GetAuditLogs lists audit entries, newest first, with real paging.
//
// Query params (all optional):
//
//	page, limit          paging (limit 1..200, default 50)
//	search               matches details / action / resource type
//	action               exact action, e.g. "status_changed"
//	resource_type        e.g. "ticket", "task", "project", "user"
//	resource_id          one record's history (used by per-record timelines)
//	user_id              actions by one user
//
// It used to hard-code page 1 / 50 rows, so nothing older than the last 50
// actions could ever be seen.
func GetAuditLogs(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	page, limit = clampPagination(page, limit)

	query := database.DB.Model(&models.AuditLog{})
	// Only entries the caller may see (see auditScopeClause). Everyone with
	// view_audit_logs used to get the whole system's history.
	if clause, args := auditScopeClause(c); clause != "" {
		query = query.Where(clause, args...)
	}

	if searchQuery := strings.TrimSpace(c.Query("search")); searchQuery != "" {
		like := "%" + strings.ToLower(searchQuery) + "%"
		query = query.Where("(LOWER(details) LIKE ? OR LOWER(action) LIKE ? OR LOWER(resource_type) LIKE ?)", like, like, like)
	}
	if action := strings.TrimSpace(c.Query("action")); action != "" {
		query = query.Where("action = ?", action)
	}
	if resourceType := strings.TrimSpace(c.Query("resource_type")); resourceType != "" {
		query = query.Where("resource_type = ?", resourceType)
	}
	if resourceID := strings.TrimSpace(c.Query("resource_id")); resourceID != "" {
		if _, err := strconv.ParseUint(resourceID, 10, 64); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "resource_id must be a number"})
			return
		}
		query = query.Where("resource_id = ?", resourceID)
	}
	if userID := strings.TrimSpace(c.Query("user_id")); userID != "" {
		if _, err := strconv.ParseUint(userID, 10, 64); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user_id must be a number"})
			return
		}
		query = query.Where("user_id = ?", userID)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count audit logs"})
		return
	}

	var logs []models.AuditLog
	if err := query.
		Preload("User").
		Order("created_at DESC, id DESC").
		Offset((page - 1) * limit).
		Limit(limit).
		Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch audit logs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"audit_logs": logs,
		"pagination": gin.H{
			"page":  page,
			"limit": limit,
			"total": total,
			"pages": (total + int64(limit) - 1) / int64(limit),
		},
	})
}

func GetAuditLog(c *gin.Context) {
	id := c.Param("id")
	var entry models.AuditLog
	q := database.DB.Preload("User").Model(&models.AuditLog{})
	if clause, args := auditScopeClause(c); clause != "" {
		q = q.Where(clause, args...)
	}
	if err := q.First(&entry, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Audit log not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"audit_log": entry})
}

// auditScopeClause limits audit entries to what the caller may see (spec
// slide 14: "a user should never see more than the work explicitly assigned
// to them" — that includes the history of work). Super admins see all.
// Anyone else with view_audit_logs sees an entry when:
//   - the record it's about is one they can see — task, subtask (through its
//     task), ticket, project, feasibility, client — by the same rules as the
//     rest of the app; or
//   - it was done by someone in their scope: their department (department
//     admin), their team and themselves (supervisor), or themselves.
//
// Returns "" (no restriction) for super admins.
func auditScopeClause(c *gin.Context) (string, []interface{}) {
	v := viewerFrom(c)
	if v.seesEverything() {
		return "", nil
	}
	var parts []string
	var args []interface{}

	// Actor in scope.
	switch {
	case v.isDeptAdmin():
		parts = append(parts, "audit_logs.user_id IN (SELECT id FROM users WHERE LOWER(department) = LOWER(?) AND deleted_at IS NULL)")
		args = append(args, v.Dept)
	case v.Role == "supervisor":
		parts = append(parts, "(audit_logs.user_id = ? OR audit_logs.user_id IN (SELECT id FROM users WHERE supervisor_id = ? AND deleted_at IS NULL))")
		args = append(args, v.ID, v.ID)
	default:
		parts = append(parts, "audit_logs.user_id = ?")
		args = append(args, v.ID)
	}

	// Record in scope.
	record := func(resourceType, sub string, subArgs []interface{}) {
		parts = append(parts, "(audit_logs.resource_type = '"+resourceType+"' AND audit_logs.resource_id IN ("+sub+"))")
		args = append(args, subArgs...)
	}
	where := func(clause string) string {
		if clause == "" {
			return ""
		}
		return " AND " + clause
	}

	tc, ta := taskScopeClause(v)
	record("task", "SELECT tasks.id FROM tasks WHERE tasks.deleted_at IS NULL"+where(tc), ta)
	record("subtask", "SELECT sub_tasks.id FROM sub_tasks JOIN tasks ON tasks.id = sub_tasks.task_id WHERE tasks.deleted_at IS NULL"+where(tc), ta)

	kc, ka := ticketScopeClause(v)
	record("ticket", "SELECT tickets.id FROM tickets WHERE tickets.deleted_at IS NULL"+where(kc), ka)

	pc, pa := projectScopeClause(v)
	record("project", "SELECT projects.id FROM projects WHERE projects.deleted_at IS NULL"+where(pc), pa)

	fc, fa := feasibilityScopeClause(v)
	record("feasibility", "SELECT feasibilities.id FROM feasibilities WHERE feasibilities.deleted_at IS NULL"+where(fc), fa)

	if !seesAllClients(c) {
		cc, ca := clientScopeClause(v)
		record("client", "SELECT clients.id FROM clients WHERE clients.deleted_at IS NULL"+where(cc), ca)
	} else {
		parts = append(parts, "audit_logs.resource_type = 'client'")
	}

	// Users in their department (department admin): account changes to
	// their own people.
	if v.isDeptAdmin() {
		record("user", "SELECT users.id FROM users WHERE LOWER(users.department) = LOWER(?)", []interface{}{v.Dept})
	}

	return "(" + strings.Join(parts, " OR ") + ")", args
}
