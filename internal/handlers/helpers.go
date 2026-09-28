package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/middleware"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
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

// validTaskStatus: an enabled task status in the configurable catalog
// (workflow.go). "archived" is never in it — only DeleteTask sets that.
func validTaskStatus(s string) bool { return isValidStatus("task", s) }

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
	if !validTaskStatus(status) {
		return http.StatusBadRequest, "Invalid status"
	}
	// By category, so renamed/added statuses follow the same rules.
	if statusCategory("task", status) == "review" {
		return http.StatusBadRequest, "Use the submit-for-review action to send a task for review"
	}
	if statusCategory("task", status) == "done" && !canApprove {
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

// assigneeError checks a user id about to be set as a task/ticket assignee:
// it must exist and be active. Returns "" when OK (or when id is nil, i.e.
// not being set). Every assign path used to accept any id at all, including
// deactivated accounts that can't log in to see the work.
func assigneeError(id *uint) string {
	if id == nil {
		return ""
	}
	var u models.User
	if err := database.DB.Select("id", "status").First(&u, *id).Error; err != nil {
		return "Assignee not found"
	}
	if u.Status != "active" {
		return "That user is deactivated and can't be assigned work"
	}
	return ""
}

// --- Internal notes / private management comments ---------------------------
//
// A comment with is_internal = true is a private management note (spec: only
// authorized management may see it). Who may see AND write them is the
// view_internal_notes permission (Settings -> permission matrix; super_admin
// always). Every task/ticket response that carries comments goes through
// these helpers, so internal notes never leave the server for anyone else —
// they used to be sent to everyone who could open the item, with the UI only
// hiding them.

func canSeeInternalNotes(c *gin.Context) bool {
	roleVal, _ := c.Get("user_role")
	role, _ := roleVal.(string)
	return middleware.HasPermission(role, "view_internal_notes")
}

// visibleComments drops internal notes unless the caller may see them.
func visibleComments(allowed bool, comments []models.Comment) []models.Comment {
	if allowed || len(comments) == 0 {
		return comments
	}
	out := make([]models.Comment, 0, len(comments))
	for _, cm := range comments {
		if !cm.IsInternal {
			out = append(out, cm)
		}
	}
	return out
}

func redactTask(c *gin.Context, t *models.Task) {
	t.Comments = visibleComments(canSeeInternalNotes(c), t.Comments)
}

func redactTasks(c *gin.Context, tasks []models.Task) {
	allowed := canSeeInternalNotes(c)
	for i := range tasks {
		tasks[i].Comments = visibleComments(allowed, tasks[i].Comments)
	}
}

func redactTicket(c *gin.Context, t *models.Ticket) {
	t.Comments = visibleComments(canSeeInternalNotes(c), t.Comments)
}

func redactTickets(c *gin.Context, tickets []models.Ticket) {
	allowed := canSeeInternalNotes(c)
	for i := range tickets {
		tickets[i].Comments = visibleComments(allowed, tickets[i].Comments)
	}
}

// --- Transferring your own work -------------------------------------------------
//
// Spec slide 20 (accountability chain): "Staff A creates Subtask -> assigns to
// Staff B", "Transferred to L2", "Returned to CNOC after L2 completion". So the
// person a ticket/task/subtask is assigned to may pass it to an active
// colleague in their OWN department, without the general "Reassign Tickets &
// Tasks" permission. Controlled by transfer_assigned_work (on by default).
//
// canTransferOwnWork returns ok=true when that applies. When it doesn't, msg
// explains why if the caller was close (they hold the permission and own the
// work) — otherwise msg is "" and the caller reports its usual 403.
func canTransferOwnWork(c *gin.Context, currentAssignee *uint, target *uint) (bool, string) {
	v := viewerFrom(c)
	if !middleware.HasPermission(v.Role, "transfer_assigned_work") {
		return false, ""
	}
	if currentAssignee == nil || *currentAssignee != v.ID {
		return false, ""
	}
	if target == nil || *target == 0 {
		return false, "Pick someone to transfer it to"
	}
	var t models.User
	if err := database.DB.Select("id", "department", "status").First(&t, *target).Error; err != nil {
		return false, "User not found"
	}
	if t.Status != "active" {
		return false, "That user is deactivated and can't be assigned work"
	}
	myDept := strings.TrimSpace(v.Dept)
	if myDept == "" || !strings.EqualFold(myDept, strings.TrimSpace(t.Department)) {
		return false, "You can only transfer your work to someone in your own department"
	}
	return true, ""
}

// --- Field-level change records --------------------------------------------------
//
// fieldDiff compares the given JSON fields of a record before and after an
// edit and returns only the ones that changed (old and new values), plus
// their names. Used so the timeline shows exactly what an edit changed
// (spec slide 20/21: previous -> new, who, when) instead of just "updated".
func fieldDiff(before, after interface{}, keys []string) (map[string]interface{}, map[string]interface{}, []string) {
	toMap := func(v interface{}) map[string]interface{} {
		m := map[string]interface{}{}
		if b, err := json.Marshal(v); err == nil {
			_ = json.Unmarshal(b, &m)
		}
		return m
	}
	bm, am := toMap(before), toMap(after)
	oldV, newV := map[string]interface{}{}, map[string]interface{}{}
	var changed []string
	for _, k := range keys {
		ob, _ := json.Marshal(bm[k])
		nb, _ := json.Marshal(am[k])
		if string(ob) != string(nb) {
			oldV[k], newV[k] = bm[k], am[k]
			changed = append(changed, k)
		}
	}
	return oldV, newV, changed
}

// Fields whose edits are recorded individually (status and assignee have
// their own audit entries).
var taskDiffFields = []string{"title", "description", "priority", "start_date", "due_date",
	"estimated_hours", "actual_hours", "labels", "story_points"}
var ticketDiffFields = []string{"title", "description", "category", "department", "priority",
	"severity", "project_id", "resolution_summary"}

// taskAssigneeRoleError: admins and super admins assign work to their team
// (staff and supervisors); they can't be given a task, sub-task or ticket
// themselves — neither another admin nor themselves. Returns "" when the
// user may be assigned (or when id is nil / 0, i.e. unassigned).
func taskAssigneeRoleError(id *uint) string {
	if id == nil || *id == 0 {
		return ""
	}
	var u models.User
	if err := database.DB.Select("id", "name", "role").First(&u, *id).Error; err != nil {
		return "Assignee not found"
	}
	if u.Role == "admin" || u.Role == "super_admin" {
		return u.Name + " is an admin — admins assign work to staff and supervisors and can't be assigned it themselves"
	}
	return ""
}

// userBasics limits a preloaded user to what "assigned by" displays.
func userBasics(db *gorm.DB) *gorm.DB {
	return db.Select("id", "name", "role", "department", "user_number")
}
