package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// AdminCreateUserInput is used by the admin-only "add a new member" flow —
// distinct from the public /auth/register endpoint, which has no way to
// set department/title/phone/avatar/hierarchy links, and isn't meant for
// one person to create an account on someone else's behalf in the first
// place (it's a public self-signup endpoint).
type AdminCreateUserInput struct {
	Name         string `json:"name" binding:"required"`
	Email        string `json:"email" binding:"required,email"`
	Password     string `json:"password"` // optional — a temp password is generated if omitted
	Role         string `json:"role" binding:"required"`
	Department   string `json:"department"`
	Title        string `json:"title"`
	Phone        string `json:"phone"`
	Avatar       string `json:"avatar"`
	SupervisorID *uint  `json:"supervisor_id"`
	AdminID      *uint  `json:"admin_id"`
	SupportTier  string `json:"support_tier"` // L1..L4; CNOC only (see normalizeSupportTier)
	// Other departments this Staff member also works in (Super Admin only;
	// see resolveExtraDepartments).
	ExtraDepartments []string `json:"extra_departments"`
}

// --- Reporting-line links --------------------------------------------------
//
// A user's "Admin" is stored in users.manager_id — there is no admin_id
// column. AdminCreateUser always wrote the form's admin_id there, but reads
// (and AdminUpdateUser) looked for admin_id, so the link was saved and then
// never shown, and could not be changed afterwards. The API keeps accepting
// "admin_id" (and "manager_id") on input; the frontend reads manager_id.

// Roles a user may point at as their Admin / Supervisor.
var adminLinkRoles = map[string]bool{"admin": true, "super_admin": true}
var supervisorLinkRoles = map[string]bool{"supervisor": true}

// resolveHierarchyLink validates a requested Admin/Supervisor link.
//   - id == nil       -> not sent; set=false (leave the column alone)
//   - *id == 0        -> clear it; set=true, value=nil
//   - otherwise       -> must be an existing user with an allowed role, and
//     not the user being edited (selfID; 0 when creating)
//
// "None" in the form is sent as 0: a JSON null can't be told apart from
// "field not sent" with a *uint, which is why clearing never worked.
func resolveHierarchyLink(id *uint, selfID uint, allowed map[string]bool, label string) (set bool, value interface{}, errMsg string) {
	if id == nil {
		return false, nil, ""
	}
	if *id == 0 {
		return true, nil, ""
	}
	if selfID != 0 && *id == selfID {
		return false, nil, "A user can't be their own " + label
	}
	var target models.User
	if err := database.DB.Select("id", "role").First(&target, *id).Error; err != nil {
		return false, nil, label + " not found"
	}
	if !allowed[target.Role] {
		return false, nil, "The selected " + label + " doesn't have a role that can be a " + label
	}
	return true, *id, ""
}

// departmentIsKnown checks a department name against the managed list
// (case-insensitive). Empty is allowed (no department). While the list is
// still empty — before any department has been created — anything is
// accepted, so existing setups aren't locked out.
func departmentIsKnown(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return true
	}
	var total int64
	database.DB.Model(&models.Department{}).Count(&total)
	if total == 0 {
		return true
	}
	// Archived departments don't take new people or work.
	var n int64
	database.DB.Model(&models.Department{}).
		Where("LOWER(name) = LOWER(?) AND (status IS NULL OR status <> ?)", name, "archived").Count(&n)
	return n > 0
}

// roleChangeError applies the guards every role change must pass, wherever it
// comes from (PUT /users/:id/role or a role field on PUT /users/:id). It
// returns (0, "") when the change is allowed.
//   - you can't change your own role (a super admin demoting themselves, or
//     an admin promoting themselves, by accident or otherwise)
//   - the last active super admin can't be demoted — that would leave the
//     system with nobody able to manage roles or permissions
func roleChangeError(c *gin.Context, target models.User, newRole string) (int, string) {
	if newRole == "" || newRole == target.Role {
		return 0, ""
	}
	if callerID(c) == target.ID {
		return http.StatusBadRequest, "You can't change your own role"
	}
	if target.Role == "super_admin" {
		var n int64
		database.DB.Model(&models.User{}).
			Where("role = ? AND status = ? AND id <> ?", "super_admin", "active", target.ID).
			Count(&n)
		if n == 0 {
			return http.StatusBadRequest, "This is the last active super admin; promote someone else first"
		}
	}
	return 0, ""
}

// --- Support tiers ---------------------------------------------------------
//
// L1..L4 are support tiers INSIDE the CNOC / Support department (spec: a
// ticket is escalated L1 -> L2 -> L3 within the department), not
// departments of their own. A tier only means something for CNOC users; for
// anyone else it is stored empty.

var validSupportTiers = map[string]bool{"L1": true, "L2": true, "L3": true, "L4": true}

// isSupportDepartment reports whether a department name is the CNOC /
// support department (case-insensitive: "CNOC", "cnoc", "CNOC / Support").
func isSupportDepartment(name string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(name)), "cnoc")
}

// normalizeSupportTier validates a requested tier for a user in `department`.
// Returns the value to store ("" outside CNOC) or an error message.
func normalizeSupportTier(tier, department string) (string, string) {
	tier = strings.ToUpper(strings.TrimSpace(tier))
	if tier == "" || !isSupportDepartment(department) {
		return "", ""
	}
	if !validSupportTiers[tier] {
		return "", "Invalid support tier (use L1, L2, L3 or L4)"
	}
	return tier, ""
}

var validUserStatuses = map[string]bool{"active": true, "inactive": true}

func generateTempPassword() (string, error) {
	bytes := make([]byte, 9)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}
