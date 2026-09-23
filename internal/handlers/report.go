package handlers

import (
	"net/http"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Every report is computed over the records the caller is allowed to see
// (visibility.go), so a dashboard number never reveals more than the lists do.
// They used to be department-wide for supervisors and staff, and company-wide
// for every admin.

func GetDashboardStats(c *gin.Context) {
	v := viewerFrom(c)

	ticketQuery := applyTicketScope(database.DB.Model(&models.Ticket{}), v)
	taskQuery := applyTaskScope(database.DB.Model(&models.Task{}), v)
	projectQuery := applyProjectScope(database.DB.Model(&models.Project{}), v)

	var stats struct {
		TotalProjects   int64 `json:"total_projects"`
		ActiveProjects  int64 `json:"active_projects"`
		TotalTasks      int64 `json:"total_tasks"`
		PendingTasks    int64 `json:"pending_tasks"`
		CompletedTasks  int64 `json:"completed_tasks"`
		TotalTickets    int64 `json:"total_tickets"`
		OpenTickets     int64 `json:"open_tickets"`
		CriticalTickets int64 `json:"critical_tickets"`
		OverdueTickets  int64 `json:"overdue_tickets"`
	}

	// Each .Session(&gorm.Session{}) reuses the already-scoped query as its
	// base instead of starting from database.DB, and archived records are
	// excluded from the active-work totals.
	projectQuery.Session(&gorm.Session{}).Where("projects.status != ?", "archived").Count(&stats.TotalProjects)
	projectQuery.Session(&gorm.Session{}).Where("projects.status = ?", "active").Count(&stats.ActiveProjects)
	taskQuery.Session(&gorm.Session{}).Where("tasks.status != ?", "archived").Count(&stats.TotalTasks)
	taskQuery.Session(&gorm.Session{}).Where("tasks.status = ?", "todo").Count(&stats.PendingTasks)
	taskQuery.Session(&gorm.Session{}).Where("tasks.status = ?", "done").Count(&stats.CompletedTasks)
	ticketQuery.Session(&gorm.Session{}).Where("tickets.status != ?", "archived").Count(&stats.TotalTickets)
	ticketQuery.Session(&gorm.Session{}).Where("tickets.status IN ?", []string{"new", "assigned", "in_progress", "pending"}).Count(&stats.OpenTickets)
	ticketQuery.Session(&gorm.Session{}).Where("tickets.priority = ? AND tickets.status != ?", "critical", "archived").Count(&stats.CriticalTickets)
	ticketQuery.Session(&gorm.Session{}).Where("tickets.sla_deadline < ? AND tickets.status NOT IN ?", time.Now(), []string{"resolved", "closed", "archived"}).Count(&stats.OverdueTickets)

	c.JSON(http.StatusOK, gin.H{"stats": stats})
}

func GetTicketsByStatus(c *gin.Context) {
	query := applyTicketScope(
		database.DB.Model(&models.Ticket{}).Select("tickets.status as status, count(*) as count").Group("tickets.status"),
		viewerFrom(c))

	var results []struct {
		Status string `json:"status"`
		Count  int64  `json:"count"`
	}
	query.Find(&results)

	c.JSON(http.StatusOK, gin.H{"tickets_by_status": results})
}

func GetTasksByStatus(c *gin.Context) {
	query := applyTaskScope(
		database.DB.Model(&models.Task{}).Select("tasks.status as status, count(*) as count").Group("tasks.status"),
		viewerFrom(c))

	var results []struct {
		Status string `json:"status"`
		Count  int64  `json:"count"`
	}
	query.Find(&results)

	c.JSON(http.StatusOK, gin.H{"tasks_by_status": results})
}

// GetWorkloadReport lists people with their open task/ticket counts. Who
// appears is limited by role: staff only themselves, supervisors themselves and
// the people they supervise, department admins their department, and super /
// system admins everyone. (It used to list the whole department to everyone,
// and every department to every admin.)
func GetWorkloadReport(c *gin.Context) {
	v := viewerFrom(c)

	var workload []struct {
		UserID      uint   `json:"user_id"`
		UserName    string `json:"user_name"`
		Role        string `json:"role"`
		Department  string `json:"department"`
		TaskCount   int64  `json:"task_count"`
		TicketCount int64  `json:"ticket_count"`
	}

	query := database.DB.Model(&models.User{}).
		Select("users.id as user_id, users.name as user_name, users.role, users.department, COALESCE(task_counts.cnt, 0) as task_count, COALESCE(ticket_counts.cnt, 0) as ticket_count").
		Joins("LEFT JOIN (SELECT assignee_id, count(*) as cnt FROM tasks WHERE status NOT IN ('done', 'cancelled', 'archived') AND deleted_at IS NULL GROUP BY assignee_id) task_counts ON users.id = task_counts.assignee_id").
		Joins("LEFT JOIN (SELECT assigned_to_id, count(*) as cnt FROM tickets WHERE status NOT IN ('resolved', 'closed', 'archived') AND deleted_at IS NULL GROUP BY assigned_to_id) ticket_counts ON users.id = ticket_counts.assigned_to_id").
		Where("users.status = ?", "active")

	switch {
	case v.seesEverything():
		// everyone
	case v.isDeptAdmin():
		query = query.Where("LOWER(users.department) = LOWER(?)", v.Dept)
	case v.Role == "supervisor":
		query = query.Where("(users.id = ? OR users.supervisor_id = ?)", v.ID, v.ID)
	default:
		query = query.Where("users.id = ?", v.ID)
	}

	query.Find(&workload)

	c.JSON(http.StatusOK, gin.H{"workload": workload})
}

func GetSLABreaches(c *gin.Context) {
	query := applyTicketScope(
		database.DB.Model(&models.Ticket{}).
			Where("tickets.sla_deadline < ? AND tickets.status NOT IN (?)", time.Now(), []string{"resolved", "closed", "archived"}),
		viewerFrom(c))

	var breaches []models.Ticket
	query.Preload("AssignedTo").Preload("Project").Preload("Client").Find(&breaches)

	c.JSON(http.StatusOK, gin.H{"sla_breaches": breaches})
}
