package handlers

import (
	"net/http"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// GET /api/directory/users
//
// A people directory for everyone who is logged in, and the source for every
// assignee picker. GET /api/users is restricted to manage_users, but the app
// needs the user list to work at all: currentUser is looked up in it, and
// supervisors need it to pick assignees. The pickers used to search
// /api/users, so for staff and supervisors every search was a 403.
//
// Scope: super_admin/admin see everyone; everyone else sees their own
// department. Password hashes are never returned.
//
// Query params (all optional):
//
//	search            name / email / title contains (case-insensitive); caps
//	                  the result at 50 rows (typeahead)
//	department        admins only: limit to one department (case-insensitive).
//	                  Everyone else is already limited to their own.
//	tier              CNOC support tier, L1..L4
//	include_inactive  "true" to include deactivated accounts. By default only
//	                  active users are returned — a deactivated account can't
//	                  log in, so it must not be offered as an assignee.
func GetUserDirectory(c *gin.Context) {
	v := viewerFrom(c)
	isAdminTier := v.Role == "super_admin" || v.Role == "admin"

	q := database.DB.Omit("password").Order("name ASC, id ASC")
	limit := 1000

	if !isAdminTier {
		q = q.Where("department = ?", v.Dept)
	} else if dept := strings.TrimSpace(c.Query("department")); dept != "" {
		q = q.Where("LOWER(department) = LOWER(?)", dept)
	}

	// tier: CNOC support tier (L1..L4), e.g. to pick an L2 agent when
	// escalating.
	if tier := strings.ToUpper(strings.TrimSpace(c.Query("tier"))); tier != "" {
		q = q.Where("support_tier = ?", tier)
	}

	if c.Query("include_inactive") != "true" {
		q = q.Where("status = ?", "active")
	}

	if search := strings.TrimSpace(c.Query("search")); search != "" {
		if r := []rune(search); len(r) > 100 {
			search = string(r[:100])
		}
		like := "%" + strings.ToLower(search) + "%"
		q = q.Where("(LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(title) LIKE ?)", like, like, like)
		limit = 50
	}

	var users []models.User
	if err := q.Limit(limit).Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load user directory"})
		return
	}
	// Belt and braces: even if Omit is ignored, never serialise a hash.
	for i := range users {
		users[i].Password = ""
	}

	c.JSON(http.StatusOK, gin.H{"users": users})
}
