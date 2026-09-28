package handlers

import (
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Client 360° view — spec slide 10: "Everything about one client, on one
// screen": Total / Running / Completed / Pending projects, Open / Closed
// tickets, Feasibilities running, and a live feed of recent tasks and
// activity, filterable at every level.
//
//	GET /api/clients/:id/overview
//
// For people with full access to the client (management, the creator, an
// explicit grant). Every list is still limited to what the caller may see.

type overviewCounts struct {
	ProjectsTotal         int `json:"projects_total"`
	ProjectsRunning       int `json:"projects_running"`
	ProjectsCompleted     int `json:"projects_completed"`
	ProjectsPending       int `json:"projects_pending"`
	TicketsOpen           int `json:"tickets_open"`
	TicketsClosed         int `json:"tickets_closed"`
	FeasibilitiesRunning  int `json:"feasibilities_running"`
	FeasibilitiesPending  int `json:"feasibilities_pending"`
	FeasibilitiesComplete int `json:"feasibilities_completed"`
}

// Grouping used by the 360° filters. Projects: planning / on hold = pending,
// active = running, completed = completed. Feasibilities: draft = pending,
// in progress = running, feasible / not feasible / converted = completed.
func projectGroup(status string) string {
	switch status {
	case "active":
		return "running"
	case "completed":
		return "completed"
	case "planning", "on_hold":
		return "pending"
	}
	return "other"
}

func feasibilityGroup(status string) string {
	switch status {
	case "in_progress":
		return "running"
	case "feasible", "not_feasible", "converted":
		return "completed"
	case "draft":
		return "pending"
	}
	return "other"
}

func GetClientOverview(c *gin.Context) {
	var client models.Client
	if err := database.DB.First(&client, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Client not found"})
		return
	}
	if clientAccessFor(c, &client) != "full" {
		c.JSON(http.StatusForbidden, gin.H{"error": "The 360° view needs full access to this client"})
		return
	}
	client.AccessLevel = "full"
	v := viewerFrom(c)

	// Projects linked to the client (any of its clients), that the caller sees.
	var projects []models.Project
	pq := database.DB.Model(&models.Project{}).
		Where("(projects.client_id = ? OR projects.id IN (SELECT project_id FROM project_clients WHERE client_id = ?))", client.ID, client.ID).
		Where("projects.status <> ?", "archived")
	pq = applyProjectScope(pq, v)
	pq.Order("projects.updated_at DESC").Find(&projects)

	var tickets []models.Ticket
	tq := database.DB.Model(&models.Ticket{}).
		Where("tickets.client_id = ? AND tickets.status <> ?", client.ID, "archived")
	tq = applyTicketScope(tq, v)
	tq.Preload("AssignedTo", func(db *gorm.DB) *gorm.DB { return db.Select("id", "name") }).
		Order("tickets.updated_at DESC").Find(&tickets)

	var feas []models.Feasibility
	fq := database.DB.Model(&models.Feasibility{}).
		Where("feasibilities.client_id = ? AND feasibilities.status <> ?", client.ID, "archived")
	fq = applyFeasibilityScope(fq, v)
	fq.Order("feasibilities.updated_at DESC").Find(&feas)

	fillProjectProgress(projects)

	var counts overviewCounts
	projectIDs := make([]uint, 0, len(projects))
	for _, p := range projects {
		projectIDs = append(projectIDs, p.ID)
		counts.ProjectsTotal++
		switch projectGroup(p.Status) {
		case "running":
			counts.ProjectsRunning++
		case "completed":
			counts.ProjectsCompleted++
		case "pending":
			counts.ProjectsPending++
		}
	}
	ticketIDs := make([]uint, 0, len(tickets))
	for _, t := range tickets {
		ticketIDs = append(ticketIDs, t.ID)
		if isFinishedTicketStatus(t.Status) {
			counts.TicketsClosed++
		} else {
			counts.TicketsOpen++
		}
	}
	feasIDs := make([]uint, 0, len(feas))
	for _, f := range feas {
		feasIDs = append(feasIDs, f.ID)
		switch feasibilityGroup(f.Status) {
		case "running":
			counts.FeasibilitiesRunning++
		case "completed":
			counts.FeasibilitiesComplete++
		case "pending":
			counts.FeasibilitiesPending++
		}
	}

	// Recent tasks on the client's projects / tickets, that the caller sees.
	var tasks []models.Task
	if len(projectIDs) > 0 || len(ticketIDs) > 0 {
		tk := database.DB.Model(&models.Task{}).Where("tasks.status <> ?", "archived")
		switch {
		case len(projectIDs) > 0 && len(ticketIDs) > 0:
			tk = tk.Where("(tasks.project_id IN ? OR tasks.ticket_id IN ?)", projectIDs, ticketIDs)
		case len(projectIDs) > 0:
			tk = tk.Where("tasks.project_id IN ?", projectIDs)
		default:
			tk = tk.Where("tasks.ticket_id IN ?", ticketIDs)
		}
		tk = applyTaskScope(tk, v)
		tk.Preload("Assignee", func(db *gorm.DB) *gorm.DB { return db.Select("id", "name") }).
			Order("tasks.updated_at DESC").Limit(10).Find(&tasks)
	}

	// Activity: audit entries for the client and its visible work.
	type ref struct {
		kind string
		ids  []uint
	}
	refs := []ref{{"client", []uint{client.ID}}, {"project", projectIDs}, {"ticket", ticketIDs}, {"feasibility", feasIDs}}
	aq := database.DB.Model(&models.AuditLog{}).
		Preload("User", func(db *gorm.DB) *gorm.DB { return db.Select("id", "name", "role") })
	cond := ""
	var args []interface{}
	for _, r := range refs {
		if len(r.ids) == 0 {
			continue
		}
		if cond != "" {
			cond += " OR "
		}
		cond += "(audit_logs.resource_type = ? AND audit_logs.resource_id IN ?)"
		args = append(args, r.kind, r.ids)
	}
	var activity []models.AuditLog
	aq = aq.Where("("+cond+")", args...)
	if !canSeeInternalNotes(c) {
		aq = aq.Where("audit_logs.action <> ?", "internal_note_added")
	}
	aq.Order("audit_logs.created_at DESC, audit_logs.id DESC").Limit(30).Find(&activity)

	c.JSON(http.StatusOK, gin.H{
		"client":        client,
		"counts":        counts,
		"projects":      projects,
		"tickets":       tickets,
		"feasibilities": feas,
		"recent_tasks":  tasks,
		"activity":      activity,
	})
}
