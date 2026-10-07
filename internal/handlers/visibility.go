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
// Department-wide visibility (supervisors, staff and other non-admin roles):
// on top of the rules above, they also see every task and ticket of every
// department they belong to (home + additional) that is NOT marked private —
// read-only. Those come back with access_level "department"; every write
// still checks userCanAccessTask / userCanAccessTicket, which this does not
// widen. A private task or ticket follows only the rules above.
//
//	task in my department    tasks.department is one of mine, or its
//	                         assignee is in one of my departments
//	ticket in my department  the department it is with now, or the one
//	                         that raised it (origin_department), is mine
//
// "Created by me" is included for tasks and tickets on purpose: the spec has
// the ticket's creator close it after client confirmation, and a creator who
// can't see what they just created is a bug in either layer.

type viewer struct {
	ID   uint
	Role string
	Dept string // home department
	// Other departments the viewer also works in (staff only; set by a
	// Super Admin — see User.ExtraDepartments). Never includes Dept.
	Extra []string
}

func viewerFrom(c *gin.Context) viewer {
	idVal, _ := c.Get("user_id")
	roleVal, _ := c.Get("user_role")
	deptVal, _ := c.Get("user_department")
	extraVal, _ := c.Get("user_extra_departments")
	id, _ := idVal.(uint)
	role, _ := roleVal.(string)
	dept, _ := deptVal.(string)
	extra, _ := extraVal.([]string)
	return viewer{ID: id, Role: role, Dept: strings.TrimSpace(dept), Extra: extra}
}

// depts is every department the viewer belongs to: home first, then any
// additional ones. Empty when they have no department at all.
func (v viewer) depts() []string {
	return userDepts(v.Dept, v.Extra)
}

// userDepts is a person's home department plus their additional ones,
// trimmed, without blanks or case-insensitive duplicates.
func userDepts(home string, extra []string) []string {
	out := make([]string, 0, 1+len(extra))
	add := func(d string) {
		d = strings.TrimSpace(d)
		if d == "" {
			return
		}
		for _, x := range out {
			if strings.EqualFold(x, d) {
				return
			}
		}
		out = append(out, d)
	}
	add(home)
	for _, d := range extra {
		add(d)
	}
	return out
}

// memberOf reports whether the user belongs to dept, as their home
// department or one of their additional ones.
func memberOf(u models.User, dept string) bool {
	for _, d := range userDepts(u.Department, u.ExtraDepartments) {
		if sameDept(d, dept) {
			return true
		}
	}
	return false
}

// sharesDept reports whether the user belongs to any of the given
// departments.
func sharesDept(u models.User, depts []string) bool {
	for _, d := range depts {
		if memberOf(u, d) {
			return true
		}
	}
	return false
}

// usersInDeptSQL matches rows of the users table that belong to a
// department — their home department, or one of their additional
// departments (users.extra_departments, a jsonb array). It takes the
// department name TWICE: pass deptArgs(name). Columns are qualified with
// "users." so it works both as the main query on users and inside a
// "SELECT id FROM users WHERE ..." subquery. The CASE guards against a
// non-array value, which jsonb_array_elements_text would reject.
const usersInDeptSQL = "(LOWER(TRIM(users.department)) = LOWER(?) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(" +
	"CASE WHEN jsonb_typeof(users.extra_departments) = 'array' THEN users.extra_departments ELSE '[]'::jsonb END" +
	") AS xd(name) WHERE LOWER(TRIM(xd.name)) = LOWER(?)))"

// deptArgs is the argument list for one usersInDeptSQL.
func deptArgs(dept string) []interface{} {
	d := strings.TrimSpace(dept)
	return []interface{}{d, d}
}

// usersInAnyDeptSQL matches users who belong to at least one of depts. With
// no departments it matches users whose home department is blank — the same
// thing the old single-department comparison did for someone with none.
func usersInAnyDeptSQL(depts []string) (string, []interface{}) {
	if len(depts) == 0 {
		return "LOWER(TRIM(users.department)) = ''", nil
	}
	parts := make([]string, 0, len(depts))
	args := make([]interface{}, 0, 2*len(depts))
	for _, d := range depts {
		parts = append(parts, usersInDeptSQL)
		args = append(args, deptArgs(d)...)
	}
	return "(" + strings.Join(parts, " OR ") + ")", args
}

// deptMemberIDsSQL is the subquery "(ids of people in a department)" for the
// scope clauses below. Like usersInDeptSQL it takes the department TWICE.
func deptMemberIDsSQL() string {
	return "(SELECT users.id FROM users WHERE " + usersInDeptSQL + " AND users.deleted_at IS NULL)"
}

func (v viewer) seesEverything() bool {
	return v.Role == "super_admin"
}

func (v viewer) isDeptAdmin() bool { return v.Role == "admin" && v.Dept != "" }

// usesDeptView: the viewer gets department-wide read access to non-private
// tasks and tickets. Super admins and department admins already see their
// whole scope; a role "admin" without a department gets nothing extra.
func (v viewer) usesDeptView() bool {
	return v.ID != 0 && !v.seesEverything() && v.Role != "admin" && len(v.depts()) > 0
}

// colInDeptsSQL matches a department-name column against any of depts,
// case- and space-insensitively. Built as explicit ORs (not IN ?) so it
// works the same wherever the clause is embedded.
func colInDeptsSQL(col string, depts []string) (string, []interface{}) {
	parts := make([]string, 0, len(depts))
	args := make([]interface{}, 0, len(depts))
	for _, d := range depts {
		parts = append(parts, "LOWER(TRIM("+col+")) = LOWER(?)")
		args = append(args, strings.TrimSpace(d))
	}
	return "(" + strings.Join(parts, " OR ") + ")", args
}

// orScope joins a role clause with the department clause.
func orScope(base string, baseArgs []interface{}, extra string, extraArgs []interface{}) (string, []interface{}) {
	if extra == "" {
		return base, baseArgs
	}
	args := make([]interface{}, 0, len(baseArgs)+len(extraArgs))
	args = append(args, baseArgs...)
	args = append(args, extraArgs...)
	return "(" + base + " OR " + extra + ")", args
}

// taskDeptClause: non-private tasks of the viewer's departments. Empty when
// the viewer doesn't get department-wide visibility.
func taskDeptClause(v viewer) (string, []interface{}) {
	if !v.usesDeptView() {
		return "", nil
	}
	depts := v.depts()
	deptSQL, deptA := colInDeptsSQL("tasks.department", depts)
	memSQL, memA := usersInAnyDeptSQL(depts)
	clause := "(COALESCE(tasks.is_private, false) = false AND (" + deptSQL +
		" OR tasks.assignee_id IN (SELECT users.id FROM users WHERE " + memSQL + " AND users.deleted_at IS NULL)))"
	args := make([]interface{}, 0, len(deptA)+len(memA))
	args = append(args, deptA...)
	args = append(args, memA...)
	return clause, args
}

// ticketDeptClause: non-private tickets that are with, or were raised by,
// one of the viewer's departments.
func ticketDeptClause(v viewer) (string, []interface{}) {
	if !v.usesDeptView() {
		return "", nil
	}
	depts := v.depts()
	curSQL, curA := colInDeptsSQL("tickets.department", depts)
	orgSQL, orgA := colInDeptsSQL("tickets.origin_department", depts)
	args := make([]interface{}, 0, len(curA)+len(orgA))
	args = append(args, curA...)
	args = append(args, orgA...)
	return "(COALESCE(tickets.is_private, false) = false AND (" + curSQL + " OR " + orgSQL + "))", args
}

// inViewerDepts reports whether dept is one of the viewer's departments.
func (v viewer) inViewerDepts(dept string) bool {
	for _, d := range v.depts() {
		if sameDept(d, dept) {
			return true
		}
	}
	return false
}

// taskInViewerDepts is the single-record form of taskDeptClause. assignee
// may be nil; it is then looked up when the task's own department doesn't
// already decide it.
func taskInViewerDepts(v viewer, t *models.Task, assignee *models.User) bool {
	if t == nil || t.IsPrivate || !v.usesDeptView() {
		return false
	}
	if v.inViewerDepts(t.Department) {
		return true
	}
	if t.AssigneeID == nil {
		return false
	}
	if assignee == nil {
		var u models.User
		if database.DB.Select("id", "department", "extra_departments").First(&u, *t.AssigneeID).Error != nil {
			return false
		}
		assignee = &u
	}
	return sharesDept(*assignee, v.depts())
}

// ticketInViewerDepts is the single-record form of ticketDeptClause.
func ticketInViewerDepts(v viewer, t *models.Ticket) bool {
	if t == nil || t.IsPrivate || !v.usesDeptView() {
		return false
	}
	return v.inViewerDepts(t.Department) || v.inViewerDepts(t.OriginDepartment)
}

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
		// "Their department's people" includes staff who are also in it
		// as an additional department (usersInDeptSQL).
		return "(LOWER(tasks.department) = LOWER(?) OR tasks.creator_id = ? OR tasks.assignee_id IN " + deptMemberIDsSQL() + " OR " + subtaskOfMine + " OR " + grantedToMe + ")",
			[]interface{}{v.Dept, v.ID, v.Dept, v.Dept, v.ID, v.ID}
	case v.Role == "supervisor":
		dc, da := taskDeptClause(v)
		return orScope("(tasks.assignee_id = ? OR tasks.creator_id = ? OR tasks.assignee_id IN (SELECT id FROM users WHERE supervisor_id = ? AND deleted_at IS NULL) OR "+subtaskOfMine+" OR "+grantedToMe+")",
			[]interface{}{v.ID, v.ID, v.ID, v.ID, v.ID}, dc, da)
	default:
		dc, da := taskDeptClause(v)
		return orScope("(tasks.assignee_id = ? OR tasks.creator_id = ? OR "+subtaskOfMine+" OR "+grantedToMe+")",
			[]interface{}{v.ID, v.ID, v.ID, v.ID}, dc, da)
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
		return "(LOWER(tickets.department) = LOWER(?) OR LOWER(tickets.origin_department) = LOWER(?) OR tickets.created_by_id = ? OR tickets.assigned_to_id IN " + deptMemberIDsSQL() + " OR LOWER(tickets.returned_from_dept) = LOWER(?) OR tickets.returned_by_id = ?)",
			[]interface{}{v.Dept, v.Dept, v.ID, v.Dept, v.Dept, v.Dept, v.ID}
	case v.Role == "supervisor":
		dc, da := ticketDeptClause(v)
		return orScope("(tickets.assigned_to_id = ? OR tickets.created_by_id = ? OR tickets.assigned_to_id IN (SELECT id FROM users WHERE supervisor_id = ? AND deleted_at IS NULL) OR tickets.returned_by_id = ?)",
			[]interface{}{v.ID, v.ID, v.ID, v.ID}, dc, da)
	default:
		// Plus tickets they worked on and returned (read-only), and the
		// non-private tickets of their departments (read-only).
		dc, da := ticketDeptClause(v)
		return orScope("(tickets.assigned_to_id = ? OR tickets.created_by_id = ? OR tickets.returned_by_id = ?)",
			[]interface{}{v.ID, v.ID, v.ID}, dc, da)
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

// userCanViewTask is read access: full access (userCanAccessTask) or the
// department-wide view of a non-private task. Reads only — detail, comments,
// work logs, documents, timeline. Every write keeps checking
// userCanAccessTask.
func userCanViewTask(c *gin.Context, t *models.Task) bool {
	return userCanAccessTask(c, t) || taskInViewerDepts(viewerFrom(c), t, nil)
}

// deptOnlyTaskView: the caller sees the task only through its department.
func deptOnlyTaskView(c *gin.Context, t *models.Task) bool {
	return !userCanAccessTask(c, t) && taskInViewerDepts(viewerFrom(c), t, nil)
}

// limitToDeptView marks a task as read-only for a department viewer. The
// linked ticket is cut to a reference: it may be private, or in a
// department the viewer isn't part of.
func limitToDeptView(t *models.Task) {
	t.Ticket = ticketRef(t.Ticket)
	t.AccessLevel = "department"
}

// ticketRef is a ticket as a reference only: id, number, title, status.
func ticketRef(t *models.Ticket) *models.Ticket {
	if t == nil {
		return nil
	}
	return &models.Ticket{
		Model:        gorm.Model{ID: t.ID},
		TicketNumber: t.TicketNumber,
		Title:        t.Title,
		Status:       t.Status,
	}
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

// applySubtaskViews sets the access level of every task in a scoped list that
// the caller doesn't fully see: "granted" (shared with them), "department"
// (a non-private task of their department — read-only), or the subtask
// reference view (limitToSubtaskView). Lookups are done once per list, not
// once per task.
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
	// Assignees of tasks whose own department isn't the viewer's — needed to
	// decide the department view without one query per task.
	assignees := map[uint]*models.User{}
	if v.usesDeptView() {
		var ids []uint
		for i := range tasks {
			if a := tasks[i].AssigneeID; a != nil && !tasks[i].IsPrivate && !v.inViewerDepts(tasks[i].Department) {
				ids = append(ids, *a)
			}
		}
		if len(ids) > 0 {
			var us []models.User
			database.DB.Select("id", "department", "extra_departments").Where("id IN ?", ids).Find(&us)
			for i := range us {
				assignees[us[i].ID] = &us[i]
			}
		}
	}
	for i := range tasks {
		var sup *uint
		if a := tasks[i].AssigneeID; a != nil && team[*a] {
			id := v.ID
			sup = &id
		}
		if taskVisibleTo(v, &tasks[i], sup) {
			continue
		}
		if granted[tasks[i].ID] {
			tasks[i].AccessLevel = "granted"
			continue
		}
		var assignee *models.User
		if a := tasks[i].AssigneeID; a != nil {
			assignee = assignees[*a]
			if assignee == nil {
				// Not loaded: the department alone decides (or it's private).
				assignee = &models.User{}
			}
		}
		if taskInViewerDepts(v, &tasks[i], assignee) {
			limitToDeptView(&tasks[i])
			continue
		}
		limitToSubtaskView(&tasks[i], v.ID)
	}
}

// applyTicketAccessLevels marks the tickets in a scoped list that the caller
// sees only through their department as "department" (read-only).
func applyTicketAccessLevels(c *gin.Context, tickets []models.Ticket) {
	v := viewerFrom(c)
	if !v.usesDeptView() || len(tickets) == 0 {
		return
	}
	team := map[uint]bool{}
	if v.Role == "supervisor" {
		var ids []uint
		database.DB.Model(&models.User{}).Where("supervisor_id = ?", v.ID).Pluck("id", &ids)
		for _, id := range ids {
			team[id] = true
		}
	}
	for i := range tickets {
		var sup *uint
		if a := tickets[i].AssignedToID; a != nil && team[*a] {
			id := v.ID
			sup = &id
		}
		if !ticketVisibleTo(v, &tickets[i], sup) && ticketInViewerDepts(v, &tickets[i]) {
			tickets[i].AccessLevel = "department"
		}
	}
}

// applyTicketAccessLevel is the single-ticket form.
func applyTicketAccessLevel(c *gin.Context, t *models.Ticket) {
	if t != nil && !userCanAccessTicket(c, t) && ticketInViewerDepts(viewerFrom(c), t) {
		t.AccessLevel = "department"
	}
}

// canSetPrivacy: who may mark a task or ticket private or public — its
// creator, supervisors, admins and the Super Admin. Someone who was only
// assigned the work can't change who else sees it.
func canSetPrivacy(v viewer, creatorID *uint) bool {
	switch v.Role {
	case "super_admin", "admin", "supervisor":
		return true
	}
	return v.ID != 0 && creatorID != nil && *creatorID == v.ID
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

// userInDept reports whether the user (if any) belongs to the department —
// as their home department or one of their additional ones.
func userInDept(userID *uint, dept string) bool {
	if userID == nil || strings.TrimSpace(dept) == "" {
		return false
	}
	var n int64
	database.DB.Model(&models.User{}).
		Where("users.id = ? AND "+usersInDeptSQL, append([]interface{}{*userID}, deptArgs(dept)...)...).Count(&n)
	return n > 0
}
