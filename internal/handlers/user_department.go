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

// maxExtraDepartments caps how many additional departments one person can
// be in. Generous; it only stops a runaway list.
const maxExtraDepartments = 20

// resolveExtraDepartments decides a user's additional departments (the ones
// besides their home department) on create and edit.
//
//   - requested == nil: not being changed. The current list is kept, but
//     cleaned up: emptied when the user is no longer Staff or has no home
//     department, and the home department is dropped from it if the user
//     was just moved into one of their additional departments.
//   - requested != nil: replace the list. Only a Super Admin may do this
//     (the request is refused for anyone else unless it changes nothing),
//     only for Staff with a home department, and only with known, active
//     departments. Names are stored as spelled in the Departments list.
//     The home department and duplicates are dropped silently.
//
// role and home are the user's role and home department as they will be
// after this save. Returns the list to store and whether it differs from
// current; a non-zero code means refuse the request with code and msg.
func resolveExtraDepartments(c *gin.Context, requested *[]string, role, home string, current []string) (list []string, changes bool, code int, msg string) {
	home = strings.TrimSpace(home)
	clean := func(in []string) []string {
		out := []string{}
		for _, d := range in {
			d = strings.TrimSpace(d)
			if d == "" || strings.EqualFold(d, home) {
				continue
			}
			dup := false
			for _, x := range out {
				if strings.EqualFold(x, d) {
					dup = true
					break
				}
			}
			if !dup {
				out = append(out, d)
			}
		}
		return out
	}
	sameList := func(a, b []string) bool {
		if len(a) != len(b) {
			return false
		}
		for i := range a {
			if !strings.EqualFold(strings.TrimSpace(a[i]), strings.TrimSpace(b[i])) {
				return false
			}
		}
		return true
	}

	if requested == nil {
		list = clean(current)
		if role != "staff" || home == "" {
			list = []string{}
		}
		return list, !sameList(list, current), 0, ""
	}

	wanted := clean(*requested)
	if !viewerFrom(c).seesEverything() {
		// Department admins can't add their people to other departments
		// (or take them out of one). Sending the list back unchanged is
		// fine — the edit form may echo it.
		if sameList(wanted, clean(current)) {
			return clean(current), false, 0, ""
		}
		return nil, false, http.StatusForbidden, "Only a Super Admin can add someone to other departments"
	}
	if len(wanted) > 0 && role != "staff" {
		return nil, false, http.StatusBadRequest, "Only Staff can belong to more than one department"
	}
	if len(wanted) > 0 && home == "" {
		return nil, false, http.StatusBadRequest, "Choose a home department before adding other departments"
	}
	if len(wanted) > maxExtraDepartments {
		return nil, false, http.StatusBadRequest, "Too many departments"
	}
	list = make([]string, 0, len(wanted))
	for _, d := range wanted {
		canon, ok := canonicalDepartment(d)
		if !ok {
			return nil, false, http.StatusBadRequest, "Unknown department: " + d
		}
		list = append(list, canon)
	}
	list = clean(list) // canonical spellings can collapse duplicates
	return list, !sameList(list, current), 0, ""
}
