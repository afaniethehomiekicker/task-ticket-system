package handlers

import (
	"net/http"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Who may do what to a ticket — spec slides 19-20 (CNOC / Support flow):
//
//	Create -> Route ("to Technical Dept / L1 / L2 / L3 / staff") -> Work ->
//	Return ("Returned to CNOC after L2 completion") -> Client confirms ->
//	Close ("Closed by User A after client confirmation") or Reopen.
//
// Two roles a person can have on a ticket:
//
//   - HANDLER — the team it is with now (ticket.department): its assignee,
//     anyone in that department with "Reassign Tickets & Tasks", or a super
//     admin. Handlers work it, change its status, assign it within their
//     department, route it on, and Return it when done.
//   - RAISER — the department it came from (ticket.origin_department): its
//     creator, anyone there with "Reassign Tickets & Tasks", or a super
//     admin. Raisers confirm with the client: they close it, or reopen it.
//
// While a ticket is away from the department that raised it, only its
// handlers act on it, and it can't be resolved or closed in place — it goes
// back with Return, and the raising department closes it after the client
// confirms. The creator can route their ticket only while it is still in
// their own department (decided: option (a) — work isn't pulled away
// mid-task).

// originOf is the department a ticket was raised in. Older tickets have no
// origin recorded: they belong where they are.
func originOf(t *models.Ticket) string {
	if o := strings.TrimSpace(t.OriginDepartment); o != "" {
		return o
	}
	return strings.TrimSpace(t.Department)
}

// isAwayFromOrigin: the ticket has been routed to another department and not
// yet returned.
func isAwayFromOrigin(t *models.Ticket) bool {
	o := strings.TrimSpace(t.OriginDepartment)
	return o != "" && !sameDept(o, t.Department)
}

func isTicketAssignee(v viewer, t *models.Ticket) bool {
	return v.ID != 0 && t.AssignedToID != nil && *t.AssignedToID == v.ID
}

func isTicketCreator(v viewer, t *models.Ticket) bool {
	return v.ID != 0 && t.CreatedByID != nil && *t.CreatedByID == v.ID
}

// handlesTicketNow: a HANDLER (see top of file).
func handlesTicketNow(v viewer, t *models.Ticket) bool {
	if v.Role == "super_admin" || isTicketAssignee(v, t) {
		return true
	}
	return canAssignWork(v.Role) && sameDept(v.Dept, t.Department)
}

// raisedTicket: a RAISER (see top of file).
func raisedTicket(v viewer, t *models.Ticket) bool {
	if v.Role == "super_admin" || isTicketCreator(v, t) {
		return true
	}
	return canAssignWork(v.Role) && sameDept(v.Dept, originOf(t))
}

// canWorkTicket: may change the ticket's status, assignment and route —
// its handlers, plus its creator while it is still in their department.
func canWorkTicket(v viewer, t *models.Ticket) bool {
	if handlesTicketNow(v, t) {
		return true
	}
	return isTicketCreator(v, t) && !isAwayFromOrigin(t)
}

// handlesForOrigin: someone handling a routed ticket who is ALSO a member of
// the department that raised it (home or additional department — e.g. a
// staff member in both CNOC and Support). They speak for both sides, so they
// may resolve / close / cancel it in place instead of using Return; the
// ticket then goes home to the raising department (finishInOrigin).
func handlesForOrigin(v viewer, t *models.Ticket) bool {
	return handlesTicketNow(v, t) && v.inViewerDepts(originOf(t))
}

// finishInOrigin: when a handlesForOrigin person finishes a routed ticket
// through the status dropdown, it moves back to the raising department the
// same way Return does — so it is with the right team for closing or
// Reopen, and Reopen knows who did the work. The assignee stays (they are in
// that department too). Returns true when it applied, so the caller can add
// a timeline note.
func finishInOrigin(v viewer, t *models.Ticket, newStatus string, updates map[string]interface{}) bool {
	cat := statusCategory("ticket", newStatus)
	if (cat != "done" && cat != "cancelled") || !isAwayFromOrigin(t) || v.Role == "super_admin" || !handlesForOrigin(v, t) {
		return false
	}
	updates["department"] = originOf(t)
	updates["returned_by_id"] = v.ID
	updates["returned_from_dept"] = t.Department
	return true
}

// finishedHomeNote is the timeline note for finishInOrigin. Call it BEFORE
// saving: GORM writes the new department back into t on Updates.
func finishedHomeNote(t *models.Ticket, newStatus string) string {
	return statusLabel("ticket", newStatus) + " in " + deptName(t.Department) + " and moved back to " + originOf(t) +
		" (handled by someone in both departments)"
}

// ticketStatusChangeError checks a status change made through the status
// dropdown or the edit form (PUT /tickets/:id, PATCH /tickets/:id/status).
// Returns 0 when allowed.
//
// Before this, anyone who could see a ticket could set any status: the team a
// ticket was routed to could close it themselves — skipping the client
// confirmation — or mark it resolved without returning it, so the raising
// department never heard. "Reopened" also bypassed the Reopen step, losing the
// client's feedback and the route back to the team that worked it.
func ticketStatusChangeError(c *gin.Context, t *models.Ticket, newStatus string) (int, string) {
	if newStatus == t.Status {
		return 0, ""
	}
	v := viewerFrom(c)
	if newStatus == "reopened" {
		return http.StatusBadRequest, "Use Reopen and add the client's feedback — it sends the ticket back to the team that worked on it"
	}
	if !canWorkTicket(v, t) {
		return http.StatusForbidden, "Only the team currently handling this ticket can change its status"
	}
	cat := statusCategory("ticket", newStatus)
	if (cat == "done" || cat == "cancelled") && isAwayFromOrigin(t) && v.Role != "super_admin" && !handlesForOrigin(v, t) {
		return http.StatusBadRequest, "This ticket was raised by " + originOf(t) +
			". When the work is done, use Return to hand it back — " + originOf(t) + " closes it after the client confirms"
	}
	return 0, ""
}

// ticketAssignError checks giving a ticket to someone (assign, transfer, or
// pre-assigning on create). The assignee must be in the department the ticket
// is with — moving it to another department is what Route is for. Assigning
// with the "Reassign" permission is for the ticket's handlers. Before this,
// the check compared the assignee with the ASSIGNER's department, so the
// raising department could hand a ticket that was with Technical to its own
// staff: the ticket claimed to be in Technical but was worked in CNOC.
// Super admins are not limited. Returns 0 when allowed.
func ticketAssignError(c *gin.Context, t *models.Ticket, assigneeID uint, viaReassignPermission bool) (int, string) {
	v := viewerFrom(c)
	if v.Role == "super_admin" {
		return 0, ""
	}
	if viaReassignPermission && !handlesTicketNow(v, t) && !(isTicketCreator(v, t) && !isAwayFromOrigin(t)) {
		return http.StatusForbidden, "Only the team currently handling this ticket can reassign it — " +
			"it is with " + deptName(t.Department)
	}
	if strings.TrimSpace(t.Department) == "" {
		return 0, ""
	}
	var u models.User
	if database.DB.Select("id", "name", "department", "extra_departments").Where("id = ?", assigneeID).First(&u).Error != nil {
		return http.StatusBadRequest, "Assignee not found"
	}
	// Home department or an additional one.
	if !memberOf(u, t.Department) {
		return http.StatusBadRequest, u.Name + " isn't in " + strings.TrimSpace(t.Department) +
			", where this ticket is. To send it to another department, use Route"
	}
	return 0, ""
}

// canonicalDepartment returns a department's name exactly as it is stored in
// the Departments list ("technical" -> "Technical"), so routed tickets don't
// carry whatever spelling was typed. ok=false for an unknown or archived
// department.
func canonicalDepartment(name string) (string, bool) {
	name = strings.TrimSpace(name)
	if name == "" || !departmentIsKnown(name) {
		return "", false
	}
	var d models.Department
	if database.DB.Select("name").Where("LOWER(name) = LOWER(?)", name).First(&d).Error == nil && strings.TrimSpace(d.Name) != "" {
		return strings.TrimSpace(d.Name), true
	}
	return name, true // no departments configured at all (see departmentIsKnown)
}

// userCanViewTicket is read access: everyone who can work on the ticket
// (userCanAccessTicket), plus the person who returned it and that
// department's admins. After Return the ticket belongs to the raising
// department again, and the team that did the work used to lose sight of it
// — and of their own history — entirely. They can read it (detail, timeline,
// lists, reports) but not change it: every write still checks
// userCanAccessTicket.
//
// Also everyone in the department a non-private ticket is with, or that
// raised it (department-wide visibility, see visibility.go) — read-only too.
func userCanViewTicket(c *gin.Context, t *models.Ticket) bool {
	if userCanAccessTicket(c, t) {
		return true
	}
	v := viewerFrom(c)
	if t.ReturnedByID != nil && *t.ReturnedByID == v.ID && v.ID != 0 {
		return true
	}
	if ticketInViewerDepts(v, t) {
		return true
	}
	return v.isDeptAdmin() && sameDept(v.Dept, t.ReturnedFromDept)
}

// userCard limits a preloaded person on a ticket (assignee, creator,
// commenters, task assignees, work-log authors) to what the screens show. It
// used to be the full user record — email, phone, reporting lines, last
// login — so once a ticket was routed, either side could read the other
// department's contact details through it (compare the people directory).
func userCard(db *gorm.DB) *gorm.DB {
	return db.Select("id", "name", "role", "department", "user_number", "avatar", "status")
}
