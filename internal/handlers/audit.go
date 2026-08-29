package handlers

import (
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

func GetAuditLogs(c *gin.Context) {
	var logs []models.AuditLog
	if result := database.DB.Preload("User").Order("created_at desc").Limit(100).Find(&logs); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch audit logs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"audit_logs": logs})
}
