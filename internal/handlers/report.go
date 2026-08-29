package handlers

import (
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// Global search across projects, tasks, and tickets
func GlobalSearch(c *gin.Context) {
	keyword := c.Query("q")
	if keyword == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Query parameter 'q' is required"})
		return
	}

	searchPattern := "%" + keyword + "%"

	var projects []models.Project
	var tasks []models.Task
	var tickets []models.Ticket

	database.DB.Where("title LIKE ? OR description LIKE ?", searchPattern, searchPattern).Find(&projects)
	database.DB.Where("title LIKE ? OR description LIKE ? OR labels LIKE ?", searchPattern, searchPattern, searchPattern).Find(&tasks)
	database.DB.Where("title LIKE ? OR description LIKE ? OR ticket_number LIKE ?", searchPattern, searchPattern, searchPattern).Find(&tickets)

	c.JSON(http.StatusOK, gin.H{
		"projects": projects,
		"tasks":    tasks,
		"tickets":  tickets,
	})
}

// Generate workload and status reports
func GetSystemReport(c *gin.Context) {
	var totalProjects, totalTasks, totalTickets int64
	var completedTasks int64
	var resolvedTickets int64

	database.DB.Model(&models.Project{}).Count(&totalProjects)
	database.DB.Model(&models.Task{}).Count(&totalTasks)
	database.DB.Model(&models.Task{}).Where("status = ?", "Completed").Count(&completedTasks)
	database.DB.Model(&models.Ticket{}).Count(&totalTickets)
	database.DB.Model(&models.Ticket{}).Where("status IN ?", []string{"Resolved", "Closed"}).Count(&resolvedTickets)

	c.JSON(http.StatusOK, gin.H{
		"summary": gin.H{
			"total_projects":   totalProjects,
			"total_tasks":      totalTasks,
			"completed_tasks":  completedTasks,
			"total_tickets":    totalTickets,
			"resolved_tickets": resolvedTickets,
		},
	})
}
