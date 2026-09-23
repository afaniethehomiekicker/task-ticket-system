package handlers

import (
	"errors"
	"net/http"
	"strings"
	"sync"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/middleware"
	"task-ticket-backend/internal/models"
)

// safeOrderClause builds an ORDER BY fragment from user-supplied sort
// parameters using a fixed whitelist. `allowed` maps the API-facing sort key
// to a SQL column (table-qualified where needed); anything not in the map
// falls back to `fallback`. Direction is only ever ASC or DESC. Never
// interpolate sort_by / sort_order into Order() directly — GORM passes a
// string to the database as raw SQL.
func safeOrderClause(sortBy, sortOrder string, allowed map[string]string, fallback string) string {
	col, ok := allowed[strings.ToLower(strings.TrimSpace(sortBy))]
	if !ok {
		col = fallback
	}
	dir := "DESC"
	if strings.EqualFold(strings.TrimSpace(sortOrder), "asc") {
		dir = "ASC"
	}
	return col + " " + dir
}

// clampPagination keeps page >= 1 and 1 <= limit <= 200. Without it, limit=0
// divides by zero in the pages calculation, page=0 gives a negative OFFSET,
// and a huge limit dumps the whole table in one response.
func clampPagination(page, limit int) (int, int) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 20
	}
	if limit > 200 {
		limit = 200
	}
	return page, limit
}

// userHasAvatarColumn / setUserAvatar: models.User wasn't available when this
// was written, so the avatar column is checked at runtime rather than assumed.
func userHasAvatarColumn() bool {
	return database.DB.Migrator().HasColumn(&models.User{}, "avatar")
}

var errNoAvatarColumn = errors.New("users table has no avatar column")

// validAvatarURL only accepts what UploadAvatar produces (or empty, to clear
// it), so a profile can't be pointed at an arbitrary external URL.
func validAvatarURL(s string) bool {
	if s == "" {
		return true
	}
	if !strings.HasPrefix(s, avatarURLPrefix) {
		return false
	}
	name := s[len(avatarURLPrefix):]
	return name != "" && !strings.ContainsAny(name, "/\\") && !strings.Contains(name, "..")
}

// columnCache remembers columns that exist. Only positive results are cached
// so a column added by a later migration is picked up without a restart.
var columnCache sync.Map

// dbHasColumn reports whether the table behind `model` has the named column.
// Handlers use it for columns the frontend needs but that may not have been
// migrated into a given database yet, so a missing column degrades one
// feature instead of failing the whole query.
func dbHasColumn(model interface{}, table, col string) bool {
	key := table + "." + col
	if _, ok := columnCache.Load(key); ok {
		return true
	}
	if database.DB.Migrator().HasColumn(model, col) {
		columnCache.Store(key, true)
		return true
	}
	return false
}

func taskHasColumn(col string) bool   { return dbHasColumn(&models.Task{}, "tasks", col) }
func ticketHasColumn(col string) bool { return dbHasColumn(&models.Ticket{}, "tickets", col) }

// statusChange is the old/new snapshot stored in the audit log's jsonb columns.
func statusChange(status string) map[string]string {
	return map[string]string{"status": status}
}

// validTaskStatuses are the statuses the generic status endpoints understand.
// "archived" is intentionally absent: only DeleteTask can set it.
var validTaskStatuses = map[string]bool{
	"todo": true, "in_progress": true, "in_review": true, "done": true,
	"blocked": true, "cancelled": true,
}

// taskStatusError checks a status set through the GENERIC endpoints
// (PUT /tasks/:id, PATCH /tasks/:id/status). It returns the HTTP code and
// message to reject with, or (0, "") if allowed.
//
// The task drawer's own comment says "Under Review" and "Completed" must only
// be reachable through Submit for Review / Approve so the review workflow's
// role checks mean something — but these endpoints accepted in_review and done
// from anyone with access to the task, so any staff member could complete
// their own task with one PATCH and skip the review entirely. PUT also
// accepted arbitrary strings.
func taskStatusError(canApprove bool, status string) (int, string) {
	if !validTaskStatuses[status] {
		return http.StatusBadRequest, "Invalid status"
	}
	if status == "in_review" {
		return http.StatusBadRequest, "Use the submit-for-review action to send a task for review"
	}
	if status == "done" && !canApprove {
		return http.StatusForbidden, "You don't have permission to mark a task done — submit it for review instead"
	}
	return 0, ""
}

// Permission checks go through the role/permission matrix (role.go) — the same
// source the frontend's canApproveWork() reads — rather than hard-coded role
// names, so custom roles and matrix edits made in Settings actually apply.
func canApproveWork(role string) bool { return middleware.HasPermission(role, "approve_work") }
func canAssignWork(role string) bool  { return middleware.HasPermission(role, "assign_tickets") }

// roleIsValid accepts the four built-ins and any role created through
// POST /api/roles. It used to accept only the built-ins (allowedRoles), so a
// custom role could be created and given permissions but never assigned.
func roleIsValid(key string) bool {
	if allowedRoles[key] {
		return true
	}
	var n int64
	database.DB.Model(&models.Role{}).Where("key = ?", key).Count(&n)
	return n > 0
}

// Editing a project's membership is the "Create & Edit Projects" permission.
// Membership now decides who can SEE a project, so letting anyone with
// department access add people (or themselves) would bypass visibility.
func canEditProjects(role string) bool { return middleware.HasPermission(role, "create_projects") }
