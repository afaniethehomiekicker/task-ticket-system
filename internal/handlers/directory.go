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
// Scope:
//
//	super_admin   everyone, full details
//	admin         everyone — full details for their OWN department; people in
//	              other departments as a reference card only (name, number,
//	              avatar, role, department, title, status). Admins need those
//	              names to show who is working on routed tickets and to borrow
//	              people across departments (spec slide 6), but another
//	              department's email addresses, phone numbers, reporting lines
//	              and login times are that department's business.
//	everyone else their own department, full details
//
// Departments are compared ignoring case and surrounding spaces, like every
// other visibility check. Password hashes are never returned.
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
	everyone := v.seesEverything() // super admin
	crossDept := v.Role == "admin" // department admin: other depts as reference cards
	sameDeptSQL := "LOWER(TRIM(department)) = LOWER(?)"

	q := database.DB.Omit("password").Order("name ASC, id ASC")
	limit := 1000

	if !everyone && !crossDept {
		q = q.Where(sameDeptSQL, v.Dept)
	}
	if everyone || crossDept {
		if dept := strings.TrimSpace(c.Query("department")); dept != "" {
			q = q.Where(sameDeptSQL, dept)
		}
	}

	// tier: CNOC support tier (L1..L4), e.g. to pick an L2 agent when
	// escalating. Tiers are only returned for the caller's own department
	// (below), so outside it this filter matches the caller's department only.
	if tier := strings.ToUpper(strings.TrimSpace(c.Query("tier"))); tier != "" {
		q = q.Where("support_tier = ?", tier)
		if !everyone {
			q = q.Where(sameDeptSQL, v.Dept)
		}
	}

	if c.Query("include_inactive") != "true" {
		q = q.Where("status = ?", "active")
	}

	if search := strings.TrimSpace(c.Query("search")); search != "" {
		if r := []rune(search); len(r) > 100 {
			search = string(r[:100])
		}
		like := "%" + strings.ToLower(search) + "%"
		if everyone {
			q = q.Where("(LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(title) LIKE ?)", like, like, like)
		} else {
			// Email only matches inside the caller's own department —
			// otherwise searching would reveal other departments' addresses
			// one letter at a time.
			q = q.Where("(LOWER(name) LIKE ? OR LOWER(title) LIKE ? OR ("+sameDeptSQL+" AND LOWER(email) LIKE ?))",
				like, like, v.Dept, like)
		}
		limit = 50
	}

	var users []models.User
	if err := q.Limit(limit).Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load user directory"})
		return
	}
	for i := range users {
		// Belt and braces: even if Omit is ignored, never serialise a hash.
		users[i].Password = ""
		if !everyone && !sameDept(users[i].Department, v.Dept) {
			users[i] = directoryCard(users[i])
		}
	}

	c.JSON(http.StatusOK, gin.H{"users": users})
}

// directoryCard is what an admin sees of someone in another department:
// enough to recognise and pick them, nothing to contact or profile them.
func directoryCard(u models.User) models.User {
	var card models.User
	card.ID = u.ID
	card.CreatedAt = u.CreatedAt
	card.UserNumber = u.UserNumber
	card.Name = u.Name
	card.Avatar = u.Avatar
	card.Role = u.Role
	card.Department = u.Department
	card.Title = u.Title
	card.Status = u.Status
	card.ArchivedAt = u.ArchivedAt
	return card
}
