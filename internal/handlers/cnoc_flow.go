package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
)

// CNOC / Support workflow — spec slide 19:
//
//	Customer Query -> First Attempt -> Create Ticket -> Assign ->
//	Work & Escalate -> Client Confirms
//	"Routed to Technical Dept / L1 / L2 / L3 / staff"
//	"Resolved -> Closed. Not resolved -> Reopened"
//	"If Client says not resolved: CNOC adds new comment/detail -> Ticket is
//	 returned or reassigned -> technical team investigates again. The loop is
//	 fully tracked, not restarted."
//
// and slide 20: "Transferred to L2", "Returned to CNOC after L2 completion",
// "Closed by User A after client confirmation".
//
//	POST /api/tickets/:id/route   {department, assigned_to_id?, note}
//	POST /api/tickets/:id/return  {note}
//	POST /api/tickets/:id/reopen  {reason}
//
// Each step is written to the ticket's timeline (audit) and added to the
// ticket as a public comment, so the whole loop reads in one place.
//
// Who may do each step (handler / raiser) is in ticket_flow_rules.go.

// loadTicketForFlow loads the ticket and checks the caller can see it.
func loadTicketForFlow(c *gin.Context, t *models.Ticket) bool {
	if err := database.DB.First(t, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return false
	}
	if !userCanAccessTicket(c, t) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return false
	}
	if t.Status == "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This ticket is archived"})
		return false
	}
	return true
}

// flowComment adds a public comment recording a flow step.
func flowComment(ticketID, userID uint, text string) {
	uid := userID
	cm := models.Comment{
		Content:  text,
		UserID:   uid,
		TicketID: &ticketID,
	}
	database.DB.Create(&cm)
}

func deptName(d string) string {
	if strings.TrimSpace(d) == "" {
		return "no department"
	}
	return d
}

// RouteTicket sends the ticket to another department (optionally to a named
// person there): "Routed to Technical Dept / L1 / L2 / L3 / staff".
//
// Allowed for the ticket's current handlers — its assignee, anyone in the
// department it is with who can reassign tickets, a super admin — and for
// its creator while it is still in their own department. It used to be open
// to the creator and to anyone with the reassign permission who could see
// the ticket, at any time: the raising department could pull a ticket away
// from the team in the middle of working on it.
func RouteTicket(c *gin.Context) {
	var t models.Ticket
	if !loadTicketForFlow(c, &t) {
		return
	}
	v := viewerFrom(c)
	if !canWorkTicket(v, &t) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the team currently handling this ticket can route it — it is with " + deptName(t.Department)})
		return
	}
	if isFinishedTicketStatus(t.Status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Reopen the ticket before routing it"})
		return
	}
	var input struct {
		Department   string `json:"department" binding:"required"`
		AssignedToID *uint  `json:"assigned_to_id"`
		Note         string `json:"note"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "department is required"})
		return
	}
	// Stored with its real spelling ("technical" -> "Technical").
	dept, ok := canonicalDepartment(input.Department)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown department"})
		return
	}
	// Routing to where it already is used to reset it to New and drop its
	// assignee.
	if sameDept(dept, t.Department) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This ticket is already with " + dept + ". To give it to someone there, use Assign"})
		return
	}
	note := strings.TrimSpace(input.Note)
	if note == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Add a note for the receiving team (what's needed)"})
		return
	}

	var assignee *models.User
	if input.AssignedToID != nil && *input.AssignedToID != 0 {
		if msg := assigneeError(input.AssignedToID); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		if msg := taskAssigneeRoleError(input.AssignedToID); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		var u models.User
		database.DB.Select("id", "name", "department").First(&u, *input.AssignedToID)
		if !strings.EqualFold(strings.TrimSpace(u.Department), dept) {
			c.JSON(http.StatusBadRequest, gin.H{"error": u.Name + " isn't in " + dept})
			return
		}
		assignee = &u
	}

	updates := map[string]interface{}{
		"department": dept,
		// A new leg of the loop: forget who returned it last time, so a later
		// Reopen goes to the team that handles it from here — not to an
		// earlier team.
		"returned_by_id":     nil,
		"returned_from_dept": "",
		// Same deadline, but the escalation chain starts again for the new
		// department — its supervisor and admin hear about a breach, instead
		// of the chain carrying on from where the old department left it.
		"auto_escalation_step": 0,
	}
	if t.OriginDepartment == "" {
		// Older tickets: the department it's leaving is where it came from.
		updates["origin_department"] = t.Department
	}
	newStatus := "new"
	var newAssignee *uint
	if assignee != nil {
		updates["assigned_to_id"] = assignee.ID
		updates["assigned_by_id"] = v.ID
		newAssignee = &assignee.ID
		newStatus = "assigned"
	} else {
		// The receiving department's admin assigns it.
		updates["assigned_to_id"] = nil
		updates["assigned_by_id"] = nil
	}
	updates["status"] = newStatus
	if err := database.DB.Model(&t).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to route ticket"})
		return
	}

	to := dept
	if assignee != nil {
		to = dept + " (" + assignee.Name + ")"
	}
	utils.LogAuditWithValues(v.ID, "routed", "ticket", t.ID,
		map[string]interface{}{"department": t.Department, "assignee": assigneeLabel(t.AssignedToID), "status": t.Status},
		map[string]interface{}{"department": dept, "assignee": assigneeLabel(newAssignee), "status": newStatus, "reason": note},
		fmt.Sprintf("Ticket %s routed: %s -> %s (note: %s)", t.TicketNumber, deptName(t.Department), to, note),
		c.ClientIP(), c.Request.UserAgent())
	if newAssignee != nil {
		notify(v.ID, notice{"routed", "Ticket " + t.TicketNumber + " routed to you",
			fmt.Sprintf("%s routed %s to you (%s): %s", actorName(v.ID), t.TicketNumber, dept, note), "ticket", t.ID}, *newAssignee)
	} else {
		notify(v.ID, notice{"routed", "Ticket " + t.TicketNumber + " routed to " + dept,
			fmt.Sprintf("%s routed %s to your department — please assign it: %s", actorName(v.ID), t.TicketNumber, note), "ticket", t.ID},
			departmentAdmins(dept)...)
	}
	flowComment(t.ID, v.ID, fmt.Sprintf("Routed to %s: %s", to, note))

	var full models.Ticket
	database.DB.Preload("Client").Preload("Project").Preload("AssignedTo", userCard).Preload("AssignedBy", userBasics).Preload("CreatedBy", userCard).
		Preload("Comments.User", userCard).First(&full, t.ID)
	redactTicket(c, &full)
	c.JSON(http.StatusOK, gin.H{"message": "Ticket routed", "ticket": full})
}

// ReturnTicket hands the ticket back to where it came from once the work is
// done: "Returned to CNOC after L2 completion". It goes back to the origin
// department and the person who created it, marked Resolved (the client
// still has to confirm), with a note of what was done.
func ReturnTicket(c *gin.Context) {
	var t models.Ticket
	if !loadTicketForFlow(c, &t) {
		return
	}
	v := viewerFrom(c)
	// The team that did the work hands it back — not the raising department
	// on its behalf (which used to be possible for anyone there with the
	// reassign permission, recording the work as done by the wrong team and
	// leaving a later Reopen nowhere to go).
	if !handlesTicketNow(v, &t) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the team handling this ticket (" + deptName(t.Department) + ") can return it"})
		return
	}
	origin := strings.TrimSpace(t.OriginDepartment)
	if origin == "" || strings.EqualFold(origin, strings.TrimSpace(t.Department)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This ticket is already with the department that raised it"})
		return
	}
	if isFinishedTicketStatus(t.Status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This ticket is already finished"})
		return
	}
	var input struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&input)
	note := strings.TrimSpace(input.Note)
	if note == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Add a note saying what was done"})
		return
	}

	updates := map[string]interface{}{
		"department":         origin,
		"status":             "resolved",
		"resolution_summary": note,
		"returned_by_id":     v.ID,
		"returned_from_dept": t.Department,
	}
	// Back to the person who raised it, if they can still take it.
	var backTo *uint
	// (Unless the creator is an admin — admins aren't assigned work; then it
	// returns unassigned for a team member of that department to pick up.)
	if t.CreatedByID != nil && assigneeError(t.CreatedByID) == "" && taskAssigneeRoleError(t.CreatedByID) == "" {
		backTo = t.CreatedByID
		updates["assigned_to_id"] = *t.CreatedByID
		updates["assigned_by_id"] = v.ID
	} else {
		updates["assigned_to_id"] = nil
	}
	applyTicketStatusSideEffects(&t, "resolved", updates)
	if err := database.DB.Model(&t).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to return ticket"})
		return
	}

	utils.LogAuditWithValues(v.ID, "returned", "ticket", t.ID,
		map[string]interface{}{"department": t.Department, "assignee": assigneeLabel(t.AssignedToID), "status": t.Status},
		map[string]interface{}{"department": origin, "assignee": assigneeLabel(backTo), "status": "resolved", "reason": note},
		fmt.Sprintf("Ticket %s returned to %s after %s completion (note: %s)", t.TicketNumber, origin, deptName(t.Department), note),
		c.ClientIP(), c.Request.UserAgent())
	returnTo := departmentAdmins(origin)
	if backTo != nil {
		returnTo = append(returnTo, *backTo)
	}
	if t.CreatedByID != nil {
		returnTo = append(returnTo, *t.CreatedByID)
	}
	notify(v.ID, notice{"returned", "Ticket " + t.TicketNumber + " returned to " + origin,
		fmt.Sprintf("%s finished work on %s and returned it — confirm with the client: %s", actorName(v.ID), t.TicketNumber, note),
		"ticket", t.ID}, returnTo...)
	flowComment(t.ID, v.ID, fmt.Sprintf("Returned to %s — work completed: %s", origin, note))

	var full models.Ticket
	database.DB.Preload("Client").Preload("Project").Preload("AssignedTo", userCard).Preload("AssignedBy", userBasics).Preload("CreatedBy", userCard).
		Preload("Comments.User", userCard).First(&full, t.ID)
	redactTicket(c, &full)
	c.JSON(http.StatusOK, gin.H{"message": "Ticket returned", "ticket": full})
}

// ReopenTicket: the client says it isn't resolved. The reason is added to the
// ticket and it goes straight back to whoever returned it (in their
// department) — "the loop is fully tracked, not restarted". Allowed for the
// raising department (its creator, anyone there who can reassign tickets, a
// super admin) and the ticket's current assignee — the people talking to the
// client.
func ReopenTicket(c *gin.Context) {
	var t models.Ticket
	if !loadTicketForFlow(c, &t) {
		return
	}
	v := viewerFrom(c)
	if !raisedTicket(v, &t) && !isTicketAssignee(v, &t) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the department that raised this ticket (" + deptName(originOf(&t)) + ") can reopen it"})
		return
	}
	if statusCategory("ticket", t.Status) != "done" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only a resolved or closed ticket can be reopened"})
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&input)
	reason := strings.TrimSpace(input.Reason)
	if reason == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Add the client's feedback (why it isn't resolved)"})
		return
	}

	updates := map[string]interface{}{"status": "reopened"}
	// Back to the team / person who returned it, when known and still active.
	dept := t.Department
	var backTo *uint
	if t.ReturnedByID != nil && assigneeError(t.ReturnedByID) == "" && taskAssigneeRoleError(t.ReturnedByID) == "" {
		backTo = t.ReturnedByID
		updates["assigned_to_id"] = *t.ReturnedByID
		updates["assigned_by_id"] = v.ID
		if t.ReturnedFromDept != "" {
			dept = t.ReturnedFromDept
			updates["department"] = dept
		}
	}
	applyTicketStatusSideEffects(&t, "reopened", updates) // fresh SLA clock
	if err := database.DB.Model(&t).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reopen ticket"})
		return
	}

	to := "its current handler"
	if backTo != nil {
		to = assigneeLabel(backTo) + " (" + deptName(dept) + ")"
	}
	utils.LogAuditWithValues(v.ID, "status_changed", "ticket", t.ID,
		map[string]interface{}{"status": t.Status, "department": t.Department, "assignee": assigneeLabel(t.AssignedToID)},
		map[string]interface{}{"status": "reopened", "department": dept, "assignee": assigneeLabel(backTo), "reason": reason},
		fmt.Sprintf("Ticket %s reopened — client says not resolved; back to %s (reason: %s)", t.TicketNumber, to, reason),
		c.ClientIP(), c.Request.UserAgent())
	flowComment(t.ID, v.ID, "Reopened — client says not resolved: "+reason)
	reopenTo := []uint{}
	if backTo != nil {
		reopenTo = append(reopenTo, *backTo)
	} else {
		reopenTo = append(reopenTo, departmentAdmins(dept)...)
	}
	notify(v.ID, notice{"reopened", "Ticket " + t.TicketNumber + " reopened",
		fmt.Sprintf("%s reopened %s — the client says it isn't resolved: %s", actorName(v.ID), t.TicketNumber, reason),
		"ticket", t.ID}, reopenTo...)

	var full models.Ticket
	database.DB.Preload("Client").Preload("Project").Preload("AssignedTo", userCard).Preload("AssignedBy", userBasics).Preload("CreatedBy", userCard).
		Preload("Comments.User", userCard).First(&full, t.ID)
	redactTicket(c, &full)
	c.JSON(http.StatusOK, gin.H{"message": "Ticket reopened", "ticket": full})
}
