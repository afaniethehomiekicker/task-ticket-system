package utils

import (
	"encoding/json"
	"log"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// LogAudit creates an audit log entry
func LogAudit(userID uint, action, resourceType string, resourceID uint, details, ipAddress, userAgent string) {
	auditLog := models.AuditLog{
		UserID:       userID,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		// AuditLog.OldValues/NewValues are jsonb columns. Leaving them as ""
		// makes Postgres reject the INSERT ("invalid input syntax for type
		// json"), and since the error was discarded below, every LogAudit
		// call in the codebase silently wrote nothing.
		OldValues: "{}",
		NewValues: "{}",
		Details:   details,
		IPAddress: ipAddress,
		UserAgent: userAgent,
	}

	// Fire and forget - don't block the request
	go writeAuditLog(&auditLog)
}

// writeAuditLog inserts the row and reports failures instead of swallowing them.
func writeAuditLog(entry *models.AuditLog) {
	if err := database.DB.Create(entry).Error; err != nil {
		log.Printf("audit: failed to write %s %s/%d: %v", entry.Action, entry.ResourceType, entry.ResourceID, err)
	}
}

// LogAuditWithValues creates an audit log entry with old/new values
func LogAuditWithValues(userID uint, action, resourceType string, resourceID uint, oldValues, newValues interface{}, details, ipAddress, userAgent string) {
	oldJSON := ToJSON(oldValues)
	newJSON := ToJSON(newValues)

	auditLog := models.AuditLog{
		UserID:       userID,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		OldValues:    oldJSON,
		NewValues:    newJSON,
		Details:      details,
		IPAddress:    ipAddress,
		UserAgent:    userAgent,
	}

	go writeAuditLog(&auditLog)
}

// ToJSON converts a struct to JSON string for audit storage
func ToJSON(v interface{}) string {
	if v == nil {
		return "{}"
	}
	data, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(data)
}

// FormatAuditDetails creates a human-readable audit detail string
func FormatAuditDetails(action, resourceType, resourceIdentifier string, changes ...string) string {
	detail := action + " " + resourceType
	if resourceIdentifier != "" {
		detail += " " + resourceIdentifier
	}
	if len(changes) > 0 {
		detail += ": " + joinChanges(changes)
	}
	return detail
}

func joinChanges(changes []string) string {
	if len(changes) == 0 {
		return ""
	}
	if len(changes) == 1 {
		return changes[0]
	}
	result := changes[0]
	for i := 1; i < len(changes); i++ {
		result += "; " + changes[i]
	}
	return result
}

// AuditMiddleware returns a Gin middleware that logs audit entries for mutating requests
func AuditMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip GET requests
		if c.Request.Method == "GET" || c.Request.Method == "HEAD" || c.Request.Method == "OPTIONS" {
			c.Next()
			return
		}

		path := c.FullPath()
		c.Next()

		// Log after request completes
		status := c.Writer.Status()
		if status >= 400 {
			return // Don't audit failed requests
		}

		userIDVal, exists := c.Get("user_id")
		if !exists {
			return
		}
		userID := userIDVal.(uint)

		// Determine resource type from path
		resourceType := resourceTypeFromPath(path)
		if resourceType == "" {
			return
		}

		action := actionFromMethod(c.Request.Method)
		details := FormatAuditDetails(action, resourceType, path)

		// Read from the gin.Context BEFORE starting the goroutine: gin reuses
		// the Context object once the request ends.
		entry := &models.AuditLog{
			UserID:       userID,
			Action:       action,
			ResourceType: resourceType,
			ResourceID:   0, // Could parse from path
			OldValues:    "{}",
			NewValues:    "{}",
			Details:      details,
			IPAddress:    c.ClientIP(),
			UserAgent:    c.Request.UserAgent(),
		}
		go writeAuditLog(entry)
	}
}

func resourceTypeFromPath(path string) string {
	if len(path) == 0 {
		return ""
	}
	// /api/tickets/123 -> tickets
	// /api/projects/456/tasks -> tasks
	parts := splitPath(path)
	if len(parts) >= 2 {
		return parts[1]
	}
	return ""
}

func actionFromMethod(method string) string {
	switch method {
	case "POST":
		return "created"
	case "PUT", "PATCH":
		return "updated"
	case "DELETE":
		return "deleted"
	default:
		return "unknown"
	}
}

func splitPath(path string) []string {
	// Simple path splitting
	var parts []string
	current := ""
	for _, c := range path {
		if c == '/' {
			if current != "" {
				parts = append(parts, current)
				current = ""
			}
		} else {
			current += string(c)
		}
	}
	if current != "" {
		parts = append(parts, current)
	}
	return parts
}

// Convenience functions for common audit patterns

func LogCreated(userID uint, resourceType string, resourceID uint, identifier string, c *gin.Context) {
	LogAudit(userID, "created", resourceType, resourceID,
		FormatAuditDetails("Created", resourceType, identifier), c.ClientIP(), c.Request.UserAgent())
}

func LogUpdated(userID uint, resourceType string, resourceID uint, identifier string, c *gin.Context) {
	LogAudit(userID, "updated", resourceType, resourceID,
		FormatAuditDetails("Updated", resourceType, identifier), c.ClientIP(), c.Request.UserAgent())
}

func LogDeleted(userID uint, resourceType string, resourceID uint, identifier string, c *gin.Context) {
	LogAudit(userID, "deleted", resourceType, resourceID,
		FormatAuditDetails("Deleted", resourceType, identifier), c.ClientIP(), c.Request.UserAgent())
}

func LogStatusChanged(userID uint, resourceType string, resourceID uint, identifier, oldStatus, newStatus string, c *gin.Context) {
	LogAudit(userID, "status_changed", resourceType, resourceID,
		FormatAuditDetails("Status changed", resourceType, identifier, oldStatus+" -> "+newStatus), c.ClientIP(), c.Request.UserAgent())
}

func LogAssigned(userID uint, resourceType string, resourceID uint, identifier, assigneeName string, c *gin.Context) {
	LogAudit(userID, "assigned", resourceType, resourceID,
		FormatAuditDetails("Assigned", resourceType, identifier, "to "+assigneeName), c.ClientIP(), c.Request.UserAgent())
}

func LogCommented(userID uint, resourceType string, resourceID uint, identifier string, c *gin.Context) {
	LogAudit(userID, "commented", resourceType, resourceID,
		FormatAuditDetails("Commented on", resourceType, identifier), c.ClientIP(), c.Request.UserAgent())
}
