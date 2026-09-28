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
// Allowed for the ticket's creator, its current assignee, or anyone with
// "Reassign Tickets & Tasks".
func RouteTicket(c *gin.Context) {
	var t models.Ticket
	if !loadTicketForFlow(c, &t) {
		return
	}
	v := viewerFrom(c)
	isCreator := t.CreatedByID != nil && *t.CreatedByID == v.ID
	isAssignee := t.AssignedToID != nil && *t.AssignedToID == v.ID
	if !isCreator && !isAssignee && !canAssignWork(v.Role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the ticket's creator, its assignee, or someone who can reassign tickets can route it"})
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
	dept := strings.TrimSpace(input.Department)
	if dept == "" || !departmentIsKnown(dept) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown department"})
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

	updates := map[string]interface{}{"department": dept}
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
	flowComment(t.ID, v.ID, fmt.Sprintf("Routed to %s: %s", to, note))

	var full models.Ticket
	database.DB.Preload("Client").Preload("Project").Preload("AssignedTo").Preload("AssignedBy", userBasics).Preload("CreatedBy").
		Preload("Comments.User").First(&full, t.ID)
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
	isAssignee := t.AssignedToID != nil && *t.AssignedToID == v.ID
	if !isAssignee && !canAssignWork(v.Role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the ticket's assignee (or someone who can reassign tickets) can return it"})
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
	flowComment(t.ID, v.ID, fmt.Sprintf("Returned to %s — work completed: %s", origin, note))

	var full models.Ticket
	database.DB.Preload("Client").Preload("Project").Preload("AssignedTo").Preload("AssignedBy", userBasics).Preload("CreatedBy").
		Preload("Comments.User").First(&full, t.ID)
	redactTicket(c, &full)
	c.JSON(http.StatusOK, gin.H{"message": "Ticket returned", "ticket": full})
}

// ReopenTicket: the client says it isn't resolved. The reason is added to the
// ticket and it goes straight back to whoever returned it (in their
// department) — "the loop is fully tracked, not restarted". Allowed for the
// ticket's creator, its current assignee, or anyone who can reassign tickets.
func ReopenTicket(c *gin.Context) {
	var t models.Ticket
	if !loadTicketForFlow(c, &t) {
		return
	}
	v := viewerFrom(c)
	isCreator := t.CreatedByID != nil && *t.CreatedByID == v.ID
	isAssignee := t.AssignedToID != nil && *t.AssignedToID == v.ID
	if !isCreator && !isAssignee && !canAssignWork(v.Role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the ticket's creator, its assignee, or someone who can reassign tickets can reopen it"})
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

	var full models.Ticket
	database.DB.Preload("Client").Preload("Project").Preload("AssignedTo").Preload("AssignedBy", userBasics).Preload("CreatedBy").
		Preload("Comments.User").First(&full, t.ID)
	redactTicket(c, &full)
	c.JSON(http.StatusOK, gin.H{"message": "Ticket reopened", "ticket": full})
}
