package handlers

import (
	"net/http"
	"strings"

	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// resolveUserDepartment decides which department a user record ends up in on
// POST /api/users (target == nil) and PUT /api/users/:id (target = the user
// being edited). It is the authoritative department check for both handlers.
//
// Why it lives here and not only in middleware.ScopeUserManagement: the
// middleware inspects the raw JSON body, which is not what the handler uses.
// Two gaps followed from that:
//
//   - Whitespace. {"department": " "} looked empty to the middleware (it
//     trims), passed departmentIsKnown (it trims too), and was then stored
//     untrimmed. Every visibility check trims the department, so an admin
//     whose department is " " counts as an admin with NO department — a
//     company-wide admin. A department admin could do this to their own
//     account and see, and manage, the whole company.
//   - Key casing. The middleware looks for the exact key "department";
//     encoding/json also fills the field from "Department", "DEPARTMENT", ...
//     so a differently-cased key skipped the middleware's check entirely.
//
// Running the check here, on the bound value, closes both. Rules:
//
//   - The requested value is trimmed; blank means "not given".
//   - Super admins may put a user in any department, or none when creating
//     (an Admin still needs one — see adminNeedsDepartment).
//   - Everyone else with manage_users (department admins) needs a department
//     of their own, may only create users in it (filled in when not given),
//     may only edit users already in it, and can't move anyone out of it.
//   - Editing never blanks a department: an empty value means "unchanged",
//     as it always has.
//
// Returns the department to store and whether it changes. When code is
// non-zero the request must be refused with code and msg.
func resolveUserDepartment(c *gin.Context, requested string, target *models.User) (dept string, changes bool, code int, msg string) {
	requested = strings.TrimSpace(requested)
	v := viewerFrom(c) // department comes from the database, already trimmed
	// scoped = everyone but a super admin (see viewer.seesEverything).
	scoped := !v.seesEverything()

	if scoped && v.Dept == "" {
		return "", false, http.StatusForbidden, "You need a department to manage users"
	}

	// --- creating ---------------------------------------------------------
	if target == nil {
		if !scoped {
			return requested, true, 0, ""
		}
		if requested != "" && !strings.EqualFold(requested, v.Dept) {
			return "", false, http.StatusForbidden, "You can only add users to your own department"
		}
		return v.Dept, true, 0, ""
	}

	// --- editing ----------------------------------------------------------
	current := strings.TrimSpace(target.Department)
	if scoped && !sameDept(current, v.Dept) {
		return "", false, http.StatusForbidden, "You can only manage users in your own department"
	}
	if requested == "" || strings.EqualFold(requested, current) {
		return current, false, 0, ""
	}
	if scoped {
		return "", false, http.StatusForbidden, "You can only move users within your own department"
	}
	return requested, true, 0, ""
}

// adminNeedsDepartment enforces spec slide 5: every Admin is a Department
// Admin. Company-wide access belongs to the Super Admin only, so an Admin
// with no department is refused wherever a user's role or department is
// saved. Returns an error message, or "" when fine.
func adminNeedsDepartment(role, department string) string {
	if role == "admin" && strings.TrimSpace(department) == "" {
		return "An Admin must belong to a department. Choose one, or make this person a Super Admin."
	}
	return ""
}
