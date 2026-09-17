package handlers

import (
	"net/http"
	"regexp"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// AllPermissionKeys is the single source of truth for every permission
// the system understands — matches the rows of the Settings & Matrix UI.
// Adding a new permission is just adding a key here; it doesn't require
// a schema change, only a code change — existing roles get an explicit
// `false` row for it the next time GetPermissionMatrix runs (it fills in
// any missing combination rather than assuming true or omitting it).
var AllPermissionKeys = []string{
	"manage_users",
	"view_audit_logs",
	"manage_matrix_permissions",
	"create_projects",
	"create_tasks",
	"approve_work",
	"escalate_tickets",
	"manage_clients",
	"assign_tickets",
}

// PermissionLabels gives each key a human-readable name, returned
// alongside the matrix so the frontend doesn't need its own separate
// hardcoded label map that could drift out of sync with this list.
var PermissionLabels = map[string]string{
	"manage_users":              "Manage User Accounts & Roles",
	"view_audit_logs":           "View System Audit Trail",
	"manage_matrix_permissions": "Settings & Matrix Management",
	"create_projects":           "Create & Edit Projects",
	"create_tasks":              "Create Tasks",
	"approve_work":              "Approve & Sign-off Tasks",
	"escalate_tickets":          "Escalate Incident Tickets",
	"manage_clients":            "Manage Client & Company Profiles",
	// Not yet wired to any specific route as an actual enforcement gate
	// — added here so it exists as a real, persistable matrix cell (the
	// frontend already has a canAssignTickets() concept referencing it),
	// but nothing currently checks it server-side. Reassignment
	// currently goes through the generic UpdateTask/UpdateTicket PUT
	// endpoints, which touch many other fields too; gating THIS specific
	// field-level change needs an in-handler check (like
	// UpdateUserProfile's self-vs-admin logic), not a route-level one —
	// separate follow-up work.
	"assign_tickets": "Reassign Tickets & Tasks",
}

var roleKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

// builtInRoleKeys mirrors allowedRoles from auth.go — kept as its own
// explicit list here rather than importing allowedRoles directly, so
// this file's protections against deleting/renaming a built-in role stay
// correct even if allowedRoles is ever edited for an unrelated reason.
var builtInRoleKeys = map[string]bool{
	"super_admin": true,
	"admin":       true,
	"supervisor":  true,
	"staff":       true,
}

// EnsureBuiltInRolesExist creates the four built-in Role rows if they
// don't already exist (idempotent) — call once at startup, after
// ConnectDB, so GET /api/roles has real rows to return even before
// anyone creates a custom one.
func EnsureBuiltInRolesExist() {
	defaults := []models.Role{
		{Key: "super_admin", Label: "Super Admin", IsBuiltIn: true},
		{Key: "admin", Label: "Admin", IsBuiltIn: true},
		{Key: "supervisor", Label: "Supervisor", IsBuiltIn: true},
		{Key: "staff", Label: "Staff", IsBuiltIn: true},
	}
	for _, r := range defaults {
		var existing models.Role
		if err := database.DB.Where("key = ?", r.Key).First(&existing).Error; err != nil {
			database.DB.Create(&r)
		}
	}
}

// GetRoles lists every role, built-in and custom. Open — a role picker
// (e.g. when creating a user) needs this list, and role names aren't
// sensitive on their own.
func GetRoles(c *gin.Context) {
	var roles []models.Role
	database.DB.Find(&roles)
	c.JSON(http.StatusOK, gin.H{"roles": roles})
}

type CreateRoleInput struct {
	Key   string `json:"key" binding:"required"`
	Label string `json:"label" binding:"required"`
}

// CreateRole adds a new custom role and seeds a full, explicit set of
// RolePermission rows for it — one per AllPermissionKeys, defaulting to
// NOT granted — so the matrix has a real row for every capability from
// the moment the role exists, rather than an ambiguous "no row yet"
// state that a permission check would have to interpret one way or the
// other.
func CreateRole(c *gin.Context) {
	var input CreateRoleInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	key := strings.ToLower(strings.TrimSpace(input.Key))
	if !roleKeyPattern.MatchString(key) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Role key must be lowercase letters, numbers, and underscores, starting with a letter"})
		return
	}
	if builtInRoleKeys[key] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "That key is reserved for a built-in role"})
		return
	}

	var existing models.Role
	if err := database.DB.Where("key = ?", key).First(&existing).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A role with that key already exists"})
		return
	}

	role := models.Role{Key: key, Label: strings.TrimSpace(input.Label), IsBuiltIn: false}
	if result := database.DB.Create(&role); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	for _, permKey := range AllPermissionKeys {
		database.DB.Create(&models.RolePermission{RoleKey: key, PermissionKey: permKey, Granted: false})
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Role created successfully", "role": role})
}

type UpdateRoleInput struct {
	Label string `json:"label" binding:"required"`
}

// UpdateRole changes only a role's display Label. Key is immutable once
// created — it's what's actually stored on User.Role and
// RolePermission.RoleKey, so renaming it would mean cascading the change
// across every user account and permission row, a riskier operation than
// this endpoint is meant for.
func UpdateRole(c *gin.Context) {
	key := c.Param("key")

	var input UpdateRoleInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var role models.Role
	if err := database.DB.Where("key = ?", key).First(&role).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Role not found"})
		return
	}

	if err := database.DB.Model(&role).Update("label", input.Label).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update role: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Role updated successfully", "role": role})
}

// DeleteRole removes a custom role — rejected for a built-in role, and
// rejected if any real user account currently holds it, so a delete can
// never silently orphan a real person into an undefined role.
func DeleteRole(c *gin.Context) {
	key := c.Param("key")

	var role models.Role
	if err := database.DB.Where("key = ?", key).First(&role).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Role already deleted"})
		return
	}

	if role.IsBuiltIn {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Built-in roles cannot be deleted"})
		return
	}

	var userCount int64
	database.DB.Model(&models.User{}).Where("role = ?", key).Count(&userCount)
	if userCount > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot delete a role that is still assigned to one or more users"})
		return
	}

	database.DB.Where("role_key = ?", key).Delete(&models.RolePermission{})
	database.DB.Delete(&role)

	c.JSON(http.StatusOK, gin.H{"message": "Role deleted successfully"})
}

// GetPermissionMatrix returns every role paired with every known
// permission key, filling in an explicit false for any combination that
// doesn't have a row yet — the frontend never has to guess what a
// missing entry means.
func GetPermissionMatrix(c *gin.Context) {
	var roles []models.Role
	database.DB.Find(&roles)

	var permRows []models.RolePermission
	database.DB.Find(&permRows)

	granted := map[string]bool{}
	for _, p := range permRows {
		granted[p.RoleKey+"|"+p.PermissionKey] = p.Granted
	}

	matrix := map[string]map[string]bool{}
	for _, r := range roles {
		matrix[r.Key] = map[string]bool{}
		for _, permKey := range AllPermissionKeys {
			matrix[r.Key][permKey] = granted[r.Key+"|"+permKey]
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"roles":             roles,
		"permission_keys":   AllPermissionKeys,
		"permission_labels": PermissionLabels,
		"matrix":            matrix,
	})
}

type SetPermissionInput struct {
	Granted bool `json:"granted"`
}

// SetPermission upserts a single role/permission cell — matches the
// matrix grid's own click-a-cell-to-toggle interaction exactly, rather
// than requiring the whole matrix to be resent for one change.
func SetPermission(c *gin.Context) {
	roleKey := c.Param("roleKey")
	permissionKey := c.Param("permissionKey")

	var input SetPermissionInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	validKey := false
	for _, k := range AllPermissionKeys {
		if k == permissionKey {
			validKey = true
			break
		}
	}
	if !validKey {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown permission key"})
		return
	}

	var role models.Role
	if err := database.DB.Where("key = ?", roleKey).First(&role).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Role not found"})
		return
	}

	var existing models.RolePermission
	err := database.DB.Where("role_key = ? AND permission_key = ?", roleKey, permissionKey).First(&existing).Error
	if err != nil {
		existing = models.RolePermission{RoleKey: roleKey, PermissionKey: permissionKey, Granted: input.Granted}
		if result := database.DB.Create(&existing); result.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
			return
		}
	} else {
		if err := database.DB.Model(&existing).Update("granted", input.Granted).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update permission: " + err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Permission updated successfully", "permission": existing})
}
