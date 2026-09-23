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
//	admin              their department (an admin with NO department is treated
//	                   as a system admin and sees everything, so an account
//	                   created without one can't be locked out)
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
	return v.Role == "super_admin" || (v.Role == "admin" && v.Dept == "")
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

func taskScopeClause(v viewer) (string, []interface{}) {
	switch {
	case v.seesEverything():
		return "", nil
	case v.isDeptAdmin():
		return "LOWER(tasks.department) = LOWER(?)", []interface{}{v.Dept}
	case v.Role == "supervisor":
		return "(tasks.assignee_id = ? OR tasks.creator_id = ? OR tasks.assignee_id IN (SELECT id FROM users WHERE supervisor_id = ? AND deleted_at IS NULL))",
			[]interface{}{v.ID, v.ID, v.ID}
	default:
		return "(tasks.assignee_id = ? OR tasks.creator_id = ?)", []interface{}{v.ID, v.ID}
	}
}

func ticketScopeClause(v viewer) (string, []interface{}) {
	switch {
	case v.seesEverything():
		return "", nil
	case v.isDeptAdmin():
		return "LOWER(tickets.department) = LOWER(?)", []interface{}{v.Dept}
	case v.Role == "supervisor":
		return "(tickets.assigned_to_id = ? OR tickets.created_by_id = ? OR tickets.assigned_to_id IN (SELECT id FROM users WHERE supervisor_id = ? AND deleted_at IS NULL))",
			[]interface{}{v.ID, v.ID, v.ID}
	default:
		return "(tickets.assigned_to_id = ? OR tickets.created_by_id = ?)", []interface{}{v.ID, v.ID}
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
		return sameDept(v.Dept, t.Department)
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
		return sameDept(v.Dept, t.Department)
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
	return taskVisibleTo(v, t, sup)
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
