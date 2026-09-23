package handlers

import (
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// GET /api/directory/users
//
// A people directory for everyone who is logged in. GET /api/users is
// restricted to manage_users, but the app needs the user list to work at all:
// currentUser is looked up in it, and supervisors need it to pick assignees.
// Without this, any account lacking manage_users loaded with an empty user
// list.
//
// Scope: super_admin/admin see everyone; everyone else sees their own
// department. Password hashes are never returned.
func GetUserDirectory(c *gin.Context) {
	roleVal, _ := c.Get("user_role")
	deptVal, _ := c.Get("user_department")
	role, _ := roleVal.(string)
	dept, _ := deptVal.(string)

	q := database.DB.Omit("password").Order("id ASC").Limit(1000)
	if role != "super_admin" && role != "admin" {
		q = q.Where("department = ?", dept)
	}

	var users []models.User
	if err := q.Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load user directory"})
		return
	}
	// Belt and braces: even if Omit is ignored, never serialise a hash.
	for i := range users {
		users[i].Password = ""
	}

	c.JSON(http.StatusOK, gin.H{"users": users})
}
