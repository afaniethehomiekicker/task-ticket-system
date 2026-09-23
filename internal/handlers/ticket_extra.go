package handlers

import (
	"net/http"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
)

// userCanAccessDepartment reports whether the caller may access a resource
// that belongs to targetDept purely on department grounds: super admins and
// admins without a department (system admins) always can; everyone else,
// including department admins, only when the departments match.
//
// It is NOT the visibility rule for tasks, tickets or projects — see
// visibility.go (userCanAccessTask / userCanAccessTicket / userCanAccessProject).
// It remains for handlers that only have a department to go on.
func userCanAccessDepartment(c *gin.Context, targetDept string) bool {
	v := viewerFrom(c)
	return v.seesEverything() || sameDept(v.Dept, targetDept)
}

// Project member handlers
func AddProjectMember(c *gin.Context) {
	var input struct {
		UserID uint `json:"user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var project models.Project
	if err := database.DB.First(&project, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}

	if !userCanAccessProject(c, &project) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	roleVal, _ := c.Get("user_role")
	role, _ := roleVal.(string)
	if !canEditProjects(role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to change project members"})
		return
	}

	var user models.User
	if err := database.DB.First(&user, input.UserID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "User not found"})
		return
	}

	if err := database.DB.Model(&project).Association("Members").Append(&user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add member"})
		return
	}

	database.DB.Preload("Members").First(&project, project.ID)
	c.JSON(http.StatusOK, gin.H{"message": "Member added successfully", "project": project})
}

func RemoveProjectMember(c *gin.Context) {
	projectID := c.Param("id")
	userID := c.Param("userId")

	var project models.Project
	if err := database.DB.First(&project, projectID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}

	if !userCanAccessProject(c, &project) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	roleVal, _ := c.Get("user_role")
	role, _ := roleVal.(string)
	if !canEditProjects(role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to change project members"})
		return
	}

	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	if err := database.DB.Model(&project).Association("Members").Delete(&user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove member"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Member removed successfully"})
}

func GetProjectTasks(c *gin.Context) {
	projectID := c.Param("id")

	var project models.Project
	if err := database.DB.First(&project, projectID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}
	if !userCanAccessProject(c, &project) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: project belongs to different department"})
		return
	}

	var tasks []models.Task
	applyTaskScope(database.DB.Where("project_id = ?", projectID), viewerFrom(c)).
		Preload("Assignee").
		Preload("Creator").
		Preload("SubTasks").
		Preload("Comments").
		Find(&tasks)

	c.JSON(http.StatusOK, gin.H{"tasks": tasks})
}

func GetProjectTickets(c *gin.Context) {
	projectID := c.Param("id")

	var project models.Project
	if err := database.DB.First(&project, projectID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}
	if !userCanAccessProject(c, &project) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: project belongs to different department"})
		return
	}

	var tickets []models.Ticket
	applyTicketScope(database.DB.Where("project_id = ?", projectID), viewerFrom(c)).
		Preload("AssignedTo").
		Preload("CreatedBy").
		Preload("Client").
		Find(&tickets)

	c.JSON(http.StatusOK, gin.H{"tickets": tickets})
}

// Ticket comments
func GetTicketComments(c *gin.Context) {
	ticketID := c.Param("id")

	var ticket models.Ticket
	if err := database.DB.First(&ticket, ticketID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}
	if !userCanAccessTicket(c, &ticket) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: ticket belongs to different department"})
		return
	}

	var comments []models.Comment
	database.DB.Where("ticket_id = ?", ticketID).
		Preload("User").
		Order("created_at asc").
		Find(&comments)

	c.JSON(http.StatusOK, gin.H{"comments": comments})
}

func AddTicketComment(c *gin.Context) {
	userIDVal, _ := c.Get("user_id")
	currentUserID := userIDVal.(uint)

	var input struct {
		Content    string `json:"content" binding:"required"`
		IsInternal bool   `json:"is_internal"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify ticket exists
	var ticket models.Ticket
	if err := database.DB.First(&ticket, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}
	if !userCanAccessTicket(c, &ticket) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: ticket belongs to different department"})
		return
	}

	comment := models.Comment{
		Content:    input.Content,
		IsInternal: input.IsInternal,
		UserID:     currentUserID,
		TicketID:   &ticket.ID,
	}

	if err := database.DB.Create(&comment).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add comment"})
		return
	}

	database.DB.Preload("User").First(&comment, comment.ID)

	utils.LogAudit(currentUserID, "commented", "ticket", ticket.ID,
		"Added comment to ticket "+ticket.TicketNumber, "", "")

	c.JSON(http.StatusCreated, gin.H{"message": "Comment added", "comment": comment})
}

// Ticket work logs
func GetTicketWorkLogs(c *gin.Context) {
	ticketID := c.Param("id")

	var ticket models.Ticket
	if err := database.DB.First(&ticket, ticketID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}
	if !userCanAccessTicket(c, &ticket) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: ticket belongs to different department"})
		return
	}

	var workLogs []models.WorkLog
	database.DB.Where("ticket_id = ?", ticketID).
		Preload("User").
		Order("date desc").
		Find(&workLogs)

	c.JSON(http.StatusOK, gin.H{"work_logs": workLogs})
}

func AddTicketWorkLog(c *gin.Context) {
	userIDVal, _ := c.Get("user_id")
	currentUserID := userIDVal.(uint)

	var input struct {
		Hours       float64   `json:"hours" binding:"required,min=0"`
		Date        time.Time `json:"date" binding:"required"`
		Description string    `json:"description"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var ticket models.Ticket
	if err := database.DB.First(&ticket, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}
	if !userCanAccessTicket(c, &ticket) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: ticket belongs to different department"})
		return
	}

	workLog := models.WorkLog{
		UserID:      currentUserID,
		TicketID:    &ticket.ID,
		Hours:       input.Hours,
		Date:        input.Date,
		Description: input.Description,
	}

	if err := database.DB.Create(&workLog).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add work log"})
		return
	}

	database.DB.Preload("User").First(&workLog, workLog.ID)

	utils.LogAudit(currentUserID, "work_log_added", "ticket", ticket.ID,
		"Added work log to ticket "+ticket.TicketNumber, "", "")

	c.JSON(http.StatusCreated, gin.H{"message": "Work log added", "work_log": workLog})
}

func GetTicketTasks(c *gin.Context) {
	ticketID := c.Param("id")

	var ticket models.Ticket
	if err := database.DB.First(&ticket, ticketID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}
	if !userCanAccessTicket(c, &ticket) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: ticket belongs to different department"})
		return
	}

	var tasks []models.Task
	applyTaskScope(database.DB.Where("ticket_id = ?", ticketID), viewerFrom(c)).
		Preload("Assignee").
		Preload("Creator").
		Preload("SubTasks").
		Find(&tasks)

	c.JSON(http.StatusOK, gin.H{"tasks": tasks})
}
