package handlers

import (
	"net/http"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// Audit log handlers
func GetAuditLogs(c *gin.Context) {
	searchQuery := strings.TrimSpace(c.Query("search"))
	action := c.Query("action")
	resourceType := c.Query("resource_type")
	userID := c.Query("user_id")
	limit := 50

	query := database.DB.
		Preload("User").
		Order("created_at desc")

	if searchQuery != "" {
		query = query.Where(
			"LOWER(details) LIKE ? OR LOWER(action) LIKE ? OR LOWER(resource_type) LIKE ?",
			"%"+strings.ToLower(searchQuery)+"%", "%"+strings.ToLower(searchQuery)+"%", "%"+strings.ToLower(searchQuery)+"%",
		)
	}
	if action != "" {
		query = query.Where("action = ?", action)
	}
	if resourceType != "" {
		query = query.Where("resource_type = ?", resourceType)
	}
	if userID != "" {
		query = query.Where("user_id = ?", userID)
	}

	var total int64
	query.Model(&models.AuditLog{}).Count(&total)

	offset := (1 - 1) * limit
	query = query.Offset(offset).Limit(limit)

	var logs []models.AuditLog
	if err := query.Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch audit logs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"audit_logs": logs,
		"pagination": gin.H{
			"page":  1,
			"limit": limit,
			"total": total,
		},
	})
}

func GetAuditLog(c *gin.Context) {
	id := c.Param("id")
	var log models.AuditLog
	if err := database.DB.Preload("User").First(&log, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Audit log not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"audit_log": log})
}
