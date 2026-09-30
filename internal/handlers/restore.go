package handlers

import (
	"fmt"
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
)

// Restore — the reverse of the archive ("delete") actions.
//
//	PATCH /api/projects/:id/restore        admin / super_admin (same as DeleteProject)
//	PATCH /api/tasks/:id/restore           admin / super_admin (same as DeleteTask)
//	PATCH /api/tickets/:id/restore         admin / super_admin (same as DeleteTicket)
//	PATCH /api/feasibilities/:id/restore   create_projects     (same as DeleteFeasibility)
//	PATCH /api/clients/:id/restore         manage_clients      (same as DeleteClient)
//
// The record goes back to the status it had when it was archived
// (pre_archive_status, recorded by the archive action). Records archived
// before that column existed have no saved status; they get a sensible
// default per type instead (see each handler). archived_at / archived_by_id
// are cleared, and old -> new status is written to the audit trail. The
// original archive entry stays in the audit log, so the full history of
// archive / restore is kept.

// restoreTarget picks the status to restore to: the saved one if it is a
// valid, non-archived status, otherwise the fallback.
func restoreTarget(saved string, valid func(string) bool, fallback string) string {
	if saved != "" && saved != "archived" && valid(saved) {
		return saved
	}
	return fallback
}

// applyRestore writes the restore to the row behind `model` (a pointer to a
// loaded record) and audits it. It has already written the error response
// when it returns false.
func applyRestore(c *gin.Context, model interface{}, resourceType string, id uint, label, target string) bool {
	if err := database.DB.Model(model).Updates(map[string]interface{}{
		"status":             target,
		"archived_at":        nil,
		"archived_by_id":     nil,
		"pre_archive_status": "",
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore " + resourceType})
		return false
	}
	utils.LogAuditWithValues(callerID(c), "restored", resourceType, id,
		statusChange("archived"), statusChange(target),
		fmt.Sprintf("Restored %s %s from the archive (status: %s)", resourceType, label, target),
		c.ClientIP(), c.Request.UserAgent())
	return true
}

func isAdminTier(c *gin.Context) bool {
	roleVal, _ := c.Get("user_role")
	role, _ := roleVal.(string)
	return role == "admin" || role == "super_admin"
}

func notArchived(c *gin.Context) {
	c.JSON(http.StatusBadRequest, gin.H{"error": "Only archived records can be restored"})
}

// ---- Projects -----------------------------------------------------------

func RestoreProject(c *gin.Context) {
	var project models.Project
	if err := database.DB.First(&project, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}
	if !userCanAccessProject(c, &project) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	if !isAdminTier(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient permissions to restore project"})
		return
	}
	if project.Status != "archived" {
		notArchived(c)
		return
	}

	target := restoreTarget(project.PreArchiveStatus, validProjectStatus, "active")
	if !applyRestore(c, &project, "project", project.ID, project.Code, target) {
		return
	}

	var full models.Project
	database.DB.Preload("Client").Preload("Clients").Preload("Owner").Preload("Admin").
		Preload("Members").Preload("Supervisors").First(&full, project.ID)
	fillOneProjectProgress(&full)
	c.JSON(http.StatusOK, gin.H{"message": "Project restored", "project": full})
}

// ---- Tasks --------------------------------------------------------------

func RestoreTask(c *gin.Context) {
	var task models.Task
	if err := database.DB.First(&task, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	if !userCanAccessTask(c, &task) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	if !isAdminTier(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient permissions to restore task"})
		return
	}
	if task.Status != "archived" {
		notArchived(c)
		return
	}

	// Back to exactly where it was, including in_review / done — restoring
	// isn't a way around the review workflow, it just undoes the archive.
	target := restoreTarget(task.PreArchiveStatus, validTaskStatus, "todo")
	if !applyRestore(c, &task, "task", task.ID, task.TaskNumber, target) {
		return
	}
	syncProjectStatusFromTasks(task.ProjectID, callerID(c))
	c.JSON(http.StatusOK, gin.H{"message": "Task restored", "task": reloadFullTask(c, task)})
}

// ---- Tickets ------------------------------------------------------------

func RestoreTicket(c *gin.Context) {
	var ticket models.Ticket
	if err := database.DB.First(&ticket, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}
	if !userCanAccessTicket(c, &ticket) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	if !isAdminTier(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient permissions to restore ticket"})
		return
	}
	if ticket.Status != "archived" {
		notArchived(c)
		return
	}

	fallback := "new"
	if ticket.AssignedToID != nil {
		fallback = "assigned"
	}
	target := restoreTarget(ticket.PreArchiveStatus, validGenericTicketStatus, fallback)
	if !applyRestore(c, &ticket, "ticket", ticket.ID, ticket.TicketNumber, target) {
		return
	}

	var full models.Ticket
	database.DB.Preload("Client").Preload("Project").Preload("AssignedTo").Preload("AssignedBy", userBasics).
		Preload("CreatedBy").Preload("Comments.User").First(&full, ticket.ID)
	redactTicket(c, &full)
	c.JSON(http.StatusOK, gin.H{"message": "Ticket restored", "ticket": full})
}

// ---- Feasibilities ------------------------------------------------------

func RestoreFeasibility(c *gin.Context) {
	var feasibility models.Feasibility
	if err := database.DB.First(&feasibility, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Feasibility not found"})
		return
	}
	if !userCanAccessFeasibility(c, &feasibility) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	if feasibility.Status != "archived" {
		notArchived(c)
		return
	}

	// "converted" is a valid place to return to (it can't be SET through the
	// generic update, but a converted feasibility that was archived should
	// come back as converted, still linked to its project).
	valid := func(s string) bool { return validFeasibilityStatus(s) || s == "converted" }
	fallback := "draft"
	if feasibility.ConvertedProjectID != nil {
		fallback = "converted"
	}
	target := restoreTarget(feasibility.PreArchiveStatus, valid, fallback)
	if !applyRestore(c, &feasibility, "feasibility", feasibility.ID, feasibility.FeasibilityNumber, target) {
		return
	}

	var full models.Feasibility
	database.DB.Preload("Client").Preload("AssignedUser").Preload("CreatedBy").Preload("Vendors").
		Preload("Attachments").Preload("ConvertedProject").First(&full, feasibility.ID)
	c.JSON(http.StatusOK, gin.H{"message": "Feasibility restored", "feasibility": full})
}

// ---- Clients ------------------------------------------------------------

func RestoreClient(c *gin.Context) {
	var client models.Client
	if err := database.DB.First(&client, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Client not found"})
		return
	}
	if client.Status != "archived" {
		notArchived(c)
		return
	}

	valid := func(s string) bool { return s == "active" || s == "inactive" }
	target := restoreTarget(client.PreArchiveStatus, valid, "active")
	if !applyRestore(c, &client, "client", client.ID, client.ClientNumber, target) {
		return
	}

	var full models.Client
	database.DB.First(&full, client.ID)
	c.JSON(http.StatusOK, gin.H{"message": "Client restored", "client": full})
}
