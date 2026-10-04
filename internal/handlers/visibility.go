package handlers

import (
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Record visibility — one place, used by every handler, matching the rules the
// frontend applies in utils/permissions (filterProjectsForUser /
// filterTasksForUser / filterTicketsForUser). The frontend used to be the only
// thing enforcing these: the API returned a whole department (or, for admins,
// the whole company) and the UI hid the rest, so anyone calling the API
// directly saw everything.
//
//	super_admin        everything
//	admin              their department. Every Admin is a Department Admin
//	                   (spec slide 5); company-wide visibility belongs to the
//	                   Super Admin alone. An admin with no department used to
//	                   be treated as a "system admin" who saw everything — a
//	                   tier the spec doesn't have. Such an account now sees only
//	                   its own work, and an Admin can't be saved without a
//	                   department (see auth.go).
//	supervisor         work assigned to them, work assigned to people they
//	                   supervise, and work they created
//	staff / any other  work assigned to them and work they created
//	projects           department / owner (admins) or membership (everyone else)
//
// "Created by me" is included for tasks and tickets on purpose: the spec has
// the ticket's creator close it after client confirmation, and a creator who
// can't see what they just created is a bug in either layer.

type viewer struct {
	ID   uint
	Role string
	Dept string
}

func viewerFrom(c *gin.Context) viewer {
	idVal, _ := c.Get("user_id")
	roleVal, _ := c.Get("user_role")
	deptVal, _ := c.Get("user_department")
	id, _ := idVal.(uint)
	role, _ := roleVal.(string)
	dept, _ := deptVal.(string)
	return viewer{ID: id, Role: role, Dept: strings.TrimSpace(dept)}
}

func (v viewer) seesEverything() bool {
	return v.Role == "super_admin"
}

func (v viewer) isDeptAdmin() bool { return v.Role == "admin" && v.Dept != "" }

func sameDept(a, b string) bool {
	a, b = strings.TrimSpace(a), strings.TrimSpace(b)
	return a != "" && strings.EqualFold(a, b)
}

// ---- list scoping (SQL) -----------------------------------------------------
// Each returns a WHERE fragment and its args; an empty fragment means "no
// restriction". Column names are table-qualified so they work with or without
// joins.

// subtaskOfMine matches tasks that have a (non-archived) subtask assigned to
// the viewer. Spec (private task hierarchy): someone given only a subtask
// still needs the parent task as context — they get a reference view of it
// (limitToSubtaskView), never the whole thing. Before this, a subtask
// assignee couldn't see the task at all, nor open or update their subtask.
const subtaskOfMine = "tasks.id IN (SELECT task_id FROM sub_tasks WHERE assignee_id = ? AND deleted_at IS NULL AND status <> 'archived')"

// grantedToMe matches tasks explicitly shared with the viewer (record-level
// grant, see models.RecordAccess). A grant gives full access to that ONE task
// — never to its project or the project's other tasks.
const grantedToMe = "tasks.id IN (SELECT record_id FROM record_accesses WHERE record_type = 'task' AND user_id = ?)"

func taskScopeClause(v viewer) (string, []interface{}) {
	switch {
	case v.seesEverything():
		return "", nil
	case v.isDeptAdmin():
		// Also subtasks handed to them from another department (spec: staff
		// can be borrowed across departments for specific work).
		// Plus work they created and work assigned to people in their
		// department, wherever its project lives: an admin who assigns a task
		// to their own staff must keep seeing it (it used to vanish when the
		// task's department came from a project in another department).
		return "(LOWER(tasks.department) = LOWER(?) OR tasks.creator_id = ? OR tasks.assignee_id IN (SELECT id FROM users WHERE LOWER(department) = LOWER(?) AND deleted_at IS NULL) OR " + subtaskOfMine + " OR " + grantedToMe + ")",
			[]interface{}{v.Dept, v.ID, v.Dept, v.ID, v.ID}
	case v.Role == "supervisor":
		return "(tasks.assignee_id = ? OR tasks.creator_id = ? OR tasks.assignee_id IN (SELECT id FROM users WHERE supervisor_id = ? AND deleted_at IS NULL) OR " + subtaskOfMine + " OR " + grantedToMe + ")",
			[]interface{}{v.ID, v.ID, v.ID, v.ID, v.ID}
	default:
		return "(tasks.assignee_id = ? OR tasks.creator_id = ? OR " + subtaskOfMine + " OR " + grantedToMe + ")", []interface{}{v.ID, v.ID, v.ID, v.ID}
	}
}

func ticketScopeClause(v viewer) (string, []interface{}) {
	switch {
	case v.seesEverything():
		return "", nil
	case v.isDeptAdmin():
		// Also tickets their department raised and routed elsewhere (CNOC
		// follows the tickets it sent to Technical / L2).
		// Plus tickets they raised and tickets assigned to their people.
		// And tickets their department worked on and returned (read-only —
		// see userCanViewTicket in ticket_flow_rules.go).
		return "(LOWER(tickets.department) = LOWER(?) OR LOWER(tickets.origin_department) = LOWER(?) OR tickets.created_by_id = ? OR tickets.assigned_to_id IN (SELECT id FROM users WHERE LOWER(department) = LOWER(?) AND deleted_at IS NULL) OR LOWER(tickets.returned_from_dept) = LOWER(?) OR tickets.returned_by_id = ?)",
			[]interface{}{v.Dept, v.Dept, v.ID, v.Dept, v.Dept, v.ID}
	case v.Role == "supervisor":
		return "(tickets.assigned_to_id = ? OR tickets.created_by_id = ? OR tickets.assigned_to_id IN (SELECT id FROM users WHERE supervisor_id = ? AND deleted_at IS NULL) OR tickets.returned_by_id = ?)",
			[]interface{}{v.ID, v.ID, v.ID, v.ID}
	default:
		// Plus tickets they worked on and returned (read-only).
		return "(tickets.assigned_to_id = ? OR tickets.created_by_id = ? OR tickets.returned_by_id = ?)", []interface{}{v.ID, v.ID, v.ID}
	}
}

func projectScopeClause(v viewer) (string, []interface{}) {
	const member = "projects.id IN (SELECT project_id FROM project_members WHERE user_id = ?)"
	switch {
	case v.seesEverything():
		return "", nil
	case v.isDeptAdmin():
		return "(LOWER(projects.department) = LOWER(?) OR projects.owner_id = ? OR " + member + ")",
			[]interface{}{v.Dept, v.ID, v.ID}
	default:
		return member, []interface{}{v.ID}
	}
}

func applyScope(q *gorm.DB, clause string, args []interface{}) *gorm.DB {
	if clause == "" {
		return q
	}
	return q.Where(clause, args...)
}

func applyTaskScope(q *gorm.DB, v viewer) *gorm.DB {
	clause, args := taskScopeClause(v)
	return applyScope(q, clause, args)
}

func applyTicketScope(q *gorm.DB, v viewer) *gorm.DB {
	clause, args := ticketScopeClause(v)
	return applyScope(q, clause, args)
}

func applyProjectScope(q *gorm.DB, v viewer) *gorm.DB {
	clause, args := projectScopeClause(v)
	return applyScope(q, clause, args)
}

// ---- single-record checks ---------------------------------------------------
// The *VisibleTo functions are pure (easy to test); the userCanAccess* wrappers
// do the small lookups they need.

func taskVisibleTo(v viewer, t *models.Task, assigneeSupervisorID *uint) bool {
	switch {
	case v.seesEverything():
		return true
	case v.isDeptAdmin():
		if sameDept(v.Dept, t.Department) || (t.CreatorID != nil && *t.CreatorID == v.ID) || userInDept(t.AssigneeID, v.Dept) {
			return true
		}
		return false
	}
	if v.ID == 0 {
		return false
	}
	if t.AssigneeID != nil && *t.AssigneeID == v.ID {
		return true
	}
	if t.CreatorID != nil && *t.CreatorID == v.ID {
		return true
	}
	return v.Role == "supervisor" && assigneeSupervisorID != nil && *assigneeSupervisorID == v.ID
}

func ticketVisibleTo(v viewer, t *models.Ticket, assigneeSupervisorID *uint) bool {
	switch {
	case v.seesEverything():
		return true
	case v.isDeptAdmin():
		return sameDept(v.Dept, t.Department) || sameDept(v.Dept, t.OriginDepartment) ||
			(t.CreatedByID != nil && *t.CreatedByID == v.ID) || userInDept(t.AssignedToID, v.Dept)
	}
	if v.ID == 0 {
		return false
	}
	if t.AssignedToID != nil && *t.AssignedToID == v.ID {
		return true
	}
	if t.CreatedByID != nil && *t.CreatedByID == v.ID {
		return true
	}
	return v.Role == "supervisor" && assigneeSupervisorID != nil && *assigneeSupervisorID == v.ID
}

func projectVisibleTo(v viewer, p *models.Project, isMember bool) bool {
	switch {
	case v.seesEverything():
		return true
	case v.isDeptAdmin():
		if sameDept(v.Dept, p.Department) || (p.OwnerID != nil && *p.OwnerID == v.ID) {
			return true
		}
	}
	return v.ID != 0 && isMember
}

func supervisorOf(userID *uint) *uint {
	if userID == nil {
		return nil
	}
	var u models.User
	if err := database.DB.Select("supervisor_id").First(&u, *userID).Error; err != nil {
		return nil
	}
	return u.SupervisorID
}

func userCanAccessTask(c *gin.Context, t *models.Task) bool {
	v := viewerFrom(c)
	var sup *uint
	if v.Role == "supervisor" {
		sup = supervisorOf(t.AssigneeID)
	}
	return taskVisibleTo(v, t, sup) || hasRecordAccess("task", t.ID, v.ID)
}

// hasRecordAccess reports an explicit grant (models.RecordAccess).
func hasRecordAccess(recordType string, recordID, userID uint) bool {
	if recordID == 0 || userID == 0 {
		return false
	}
	var n int64
	database.DB.Model(&models.RecordAccess{}).
		Where("record_type = ? AND record_id = ? AND user_id = ?", recordType, recordID, userID).
		Count(&n)
	return n > 0
}

func userCanAccessTicket(c *gin.Context, t *models.Ticket) bool {
	v := viewerFrom(c)
	var sup *uint
	if v.Role == "supervisor" {
		sup = supervisorOf(t.AssignedToID)
	}
	return ticketVisibleTo(v, t, sup)
}

func userCanAccessProject(c *gin.Context, p *models.Project) bool {
	v := viewerFrom(c)
	isMember := false
	if !v.seesEverything() && v.ID != 0 {
		var n int64
		database.DB.Table("project_members").Where("project_id = ? AND user_id = ?", p.ID, v.ID).Count(&n)
		isMember = n > 0
	}
	return projectVisibleTo(v, p, isMember)
}

// ---- subtask-only access ------------------------------------------------------
//
// Full access (userCanAccessTask) is unchanged and still guards every write
// and every detail endpoint (comments, checklist, work logs, attachments,
// dependencies). Subtask-only access is a separate, read-mostly level: the
// parent task as a reference, plus the caller's own subtasks.

// hasSubtaskAssignedIn reports whether userID is assigned a live subtask of
// the task.
func hasSubtaskAssignedIn(taskID, userID uint) bool {
	if taskID == 0 || userID == 0 {
		return false
	}
	var n int64
	database.DB.Model(&models.SubTask{}).
		Where("task_id = ? AND assignee_id = ? AND status <> ?", taskID, userID, "archived").
		Count(&n)
	return n > 0
}

// subtaskOnlyAccess: the caller can't see the task normally, but is assigned
// one of its subtasks.
func subtaskOnlyAccess(c *gin.Context, t *models.Task) bool {
	return !userCanAccessTask(c, t) && hasSubtaskAssignedIn(t.ID, viewerFrom(c).ID)
}

// limitToSubtaskView reduces a task to the reference view for a subtask
// assignee: the task's own fields and project name stay; only their own
// subtasks are kept; comments, checklist, work logs, attachments,
// dependencies and the linked ticket are removed; the project is cut down to
// id / code / title / status (no budget, members or client).
func limitToSubtaskView(t *models.Task, userID uint) {
	mine := make([]models.SubTask, 0, len(t.SubTasks))
	for _, st := range t.SubTasks {
		if st.AssigneeID != nil && *st.AssigneeID == userID && st.Status != "archived" {
			mine = append(mine, st)
		}
	}
	t.SubTasks = mine
	t.Comments = nil
	t.Checklists = nil
	t.WorkLogs = nil
	t.Attachments = nil
	t.Dependencies = nil
	t.Ticket = nil
	t.Project = projectRef(t.Project)
	t.AccessLevel = "subtask"
}

// applySubtaskViews applies limitToSubtaskView to every task in a scoped list
// that the caller only sees through a subtask.
func applySubtaskViews(c *gin.Context, tasks []models.Task) {
	v := viewerFrom(c)
	if v.seesEverything() || len(tasks) == 0 {
		return
	}
	// A supervisor's team, loaded once (not one lookup per task).
	team := map[uint]bool{}
	if v.Role == "supervisor" {
		var ids []uint
		database.DB.Model(&models.User{}).Where("supervisor_id = ?", v.ID).Pluck("id", &ids)
		for _, id := range ids {
			team[id] = true
		}
	}
	// Tasks explicitly shared with the viewer, loaded once.
	granted := map[uint]bool{}
	var grantedIDs []uint
	database.DB.Model(&models.RecordAccess{}).
		Where("record_type = ? AND user_id = ?", "task", v.ID).Pluck("record_id", &grantedIDs)
	for _, id := range grantedIDs {
		granted[id] = true
	}
	for i := range tasks {
		var sup *uint
		if a := tasks[i].AssigneeID; a != nil && team[*a] {
			id := v.ID
			sup = &id
		}
		if granted[tasks[i].ID] && !taskVisibleTo(v, &tasks[i], sup) {
			tasks[i].AccessLevel = "granted"
			continue
		}
		if !taskVisibleTo(v, &tasks[i], sup) {
			limitToSubtaskView(&tasks[i], v.ID)
		}
	}
}

// ---- feasibilities ------------------------------------------------------------
//
// Feasibilities used to have no access control at all: every logged-in user
// could list, read and edit every one. Same shape as tasks: you see a
// feasibility if it's assigned to you or you raised it; a supervisor also
// sees their team's; a department admin sees their department's (plus any
// assigned to or raised by them); super_admin sees everything.

func feasibilityScopeClause(v viewer) (string, []interface{}) {
	switch {
	case v.seesEverything():
		return "", nil
	case v.isDeptAdmin():
		return "(LOWER(feasibilities.assigned_dept) = LOWER(?) OR feasibilities.assigned_user_id = ? OR feasibilities.created_by_id = ?)",
			[]interface{}{v.Dept, v.ID, v.ID}
	case v.Role == "supervisor":
		return "(feasibilities.assigned_user_id = ? OR feasibilities.created_by_id = ? OR feasibilities.assigned_user_id IN (SELECT id FROM users WHERE supervisor_id = ? AND deleted_at IS NULL))",
			[]interface{}{v.ID, v.ID, v.ID}
	default:
		return "(feasibilities.assigned_user_id = ? OR feasibilities.created_by_id = ?)", []interface{}{v.ID, v.ID}
	}
}

func applyFeasibilityScope(q *gorm.DB, v viewer) *gorm.DB {
	clause, args := feasibilityScopeClause(v)
	return applyScope(q, clause, args)
}

func feasibilityVisibleTo(v viewer, f *models.Feasibility, assigneeSupervisorID *uint) bool {
	switch {
	case v.seesEverything():
		return true
	case v.isDeptAdmin() && sameDept(v.Dept, f.AssignedDept):
		return true
	}
	if v.ID == 0 {
		return false
	}
	if f.AssignedUserID != nil && *f.AssignedUserID == v.ID {
		return true
	}
	if f.CreatedByID != nil && *f.CreatedByID == v.ID {
		return true
	}
	return v.Role == "supervisor" && assigneeSupervisorID != nil && *assigneeSupervisorID == v.ID
}

func userCanAccessFeasibility(c *gin.Context, f *models.Feasibility) bool {
	v := viewerFrom(c)
	var sup *uint
	if v.Role == "supervisor" {
		sup = supervisorOf(f.AssignedUserID)
	}
	return feasibilityVisibleTo(v, f, sup)
}

// ---- project as a reference (spec slide 14) ------------------------------------
//
// "Assigning a Task must not expose the whole Project": someone who can see a
// task but not its project gets the project as a reference only — id, code,
// title, status — never its budget, members, client or supervisors. This
// applied to plain assignees too: every task response used to embed the full
// project row.

func projectRef(p *models.Project) *models.Project {
	if p == nil {
		return nil
	}
	return &models.Project{
		Model:  gorm.Model{ID: p.ID},
		Code:   p.Code,
		Title:  p.Title,
		Status: p.Status,
	}
}

// reduceProjectsToRef replaces each task's embedded project with a reference
// when the caller can't see that project.
func reduceProjectsToRef(c *gin.Context, tasks []models.Task) {
	v := viewerFrom(c)
	if v.seesEverything() || len(tasks) == 0 {
		return
	}
	// Visible projects among those referenced, decided once per project.
	decided := map[uint]bool{}
	for i := range tasks {
		p := tasks[i].Project
		if p == nil {
			continue
		}
		ok, seen := decided[p.ID]
		if !seen {
			ok = userCanAccessProject(c, p)
			decided[p.ID] = ok
		}
		if !ok {
			tasks[i].Project = projectRef(p)
		}
	}
}

func reduceProjectToRef(c *gin.Context, t *models.Task) {
	if t.Project != nil && !viewerFrom(c).seesEverything() && !userCanAccessProject(c, t.Project) {
		t.Project = projectRef(t.Project)
	}
}

// userInDept reports whether the user (if any) belongs to the department.
func userInDept(userID *uint, dept string) bool {
	if userID == nil || strings.TrimSpace(dept) == "" {
		return false
	}
	var n int64
	database.DB.Model(&models.User{}).
		Where("id = ? AND LOWER(department) = LOWER(?)", *userID, dept).Count(&n)
	return n > 0
}
