package handlers

import (
	"net/http"
	"regexp"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
)

// AllPermissionKeys is the single source of truth for every permission
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
	"manage_departments",
}

var PermissionLabels = map[string]string{
	"manage_users":              "Manage User Accounts & Roles",
	"view_audit_logs":           "View System Audit Trail",
	"manage_matrix_permissions": "Settings & Matrix Management",
	"create_projects":           "Create & Edit Projects",
	"create_tasks":              "Create Tasks",
	"approve_work":              "Approve & Sign-off Tasks",
	"escalate_tickets":          "Escalate Incident Tickets",
	"manage_clients":            "Manage Client & Company Profiles",
	"assign_tickets":            "Reassign Tickets & Tasks",
	"manage_departments":        "Manage Departments",
}

var roleKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

var builtInRoleKeys = map[string]bool{
	"super_admin": true,
	"admin":       true,
	"supervisor":  true,
	"staff":       true,
}

// EnsureBuiltInRolesExist creates the four built-in Role rows if they don't exist (idempotent)
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
	// Seed default permissions for built-in roles
	seedDefaultPermissions()
}

func seedDefaultPermissions() {
	// Super Admin gets everything (handled by bypass in middleware, but seed for UI)
	// Admin defaults
	adminPerms := map[string]bool{
		"manage_users":              true,
		"view_audit_logs":           false,
		"manage_matrix_permissions": false,
		"create_projects":           true,
		"create_tasks":              true,
		"approve_work":              true,
		"escalate_tickets":          true,
		"manage_clients":            true,
		"assign_tickets":            true,
		"manage_departments":        true,
	}
	// Supervisor defaults
	supervisorPerms := map[string]bool{
		"manage_users":              false,
		"view_audit_logs":           false,
		"manage_matrix_permissions": false,
		"create_projects":           false,
		"create_tasks":              true,
		"approve_work":              true,
		"escalate_tickets":          true,
		"manage_clients":            false,
		"assign_tickets":            true,
		"manage_departments":        false,
	}
	// Staff defaults
	staffPerms := map[string]bool{
		"manage_users":              false,
		"view_audit_logs":           false,
		"manage_matrix_permissions": false,
		"create_projects":           false,
		"create_tasks":              false,
		"approve_work":              false,
		"escalate_tickets":          true,
		"manage_clients":            false,
		"assign_tickets":            false,
		"manage_departments":        false,
	}

	rolePerms := map[string]map[string]bool{
		"admin":      adminPerms,
		"supervisor": supervisorPerms,
		"staff":      staffPerms,
	}

	for roleKey, perms := range rolePerms {
		for permKey, granted := range perms {
			var existing models.RolePermission
			err := database.DB.Where("role_key = ? AND permission_key = ?", roleKey, permKey).First(&existing).Error
			if err != nil {
				database.DB.Create(&models.RolePermission{RoleKey: roleKey, PermissionKey: permKey, Granted: granted})
			}
		}
	}
}

// GetRoles lists every role, built-in and custom
func GetRoles(c *gin.Context) {
	var roles []models.Role
	database.DB.Find(&roles)
	c.JSON(http.StatusOK, gin.H{"roles": roles})
}

type CreateRoleInput struct {
	Key   string `json:"key" binding:"required"`
	Label string `json:"label" binding:"required"`
}

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

	// Seed all permissions as false for new role
	for _, permKey := range AllPermissionKeys {
		database.DB.Create(&models.RolePermission{RoleKey: key, PermissionKey: permKey, Granted: false})
	}

	auditRoleChange(c, "role_created", key, nil, map[string]string{"key": key, "label": role.Label}, "Created role "+key)

	c.JSON(http.StatusCreated, gin.H{"message": "Role created successfully", "role": role})
}

type UpdateRoleInput struct {
	Label string `json:"label" binding:"required"`
}

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

	// Unscoped (real delete) on purpose. These are configuration rows, and both
	// tables have a unique index that still counts soft-deleted rows — so after
	// a soft delete, re-creating a role with the same key failed on the index
	// and its permission rows could never be recreated or granted again.
	database.DB.Unscoped().Where("role_key = ?", key).Delete(&models.RolePermission{})
	database.DB.Unscoped().Delete(&role)

	auditRoleChange(c, "role_deleted", key, map[string]string{"key": key, "label": role.Label}, nil, "Deleted role "+key)

	c.JSON(http.StatusOK, gin.H{"message": "Role deleted successfully"})
}

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

func SetPermission(c *gin.Context) {
	// Was c.Param("roleKey") — the route (routes.go) defines this segment
	// as ":key", not ":roleKey", so that call always returned "" and the
	// role lookup below could never match anything. UpdateRole/DeleteRole
	// above both correctly read c.Param("key") for the same segment on
	// their own routes; this was the one place that didn't.
	roleKey := c.Param("key")
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
	oldGranted := err == nil && existing.Granted
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

	auditRoleChange(c, "permission_changed", roleKey,
		map[string]interface{}{"role": roleKey, "permission": permissionKey, "granted": oldGranted},
		map[string]interface{}{"role": roleKey, "permission": permissionKey, "granted": input.Granted},
		"Permission "+permissionKey+" for role "+roleKey+" set to "+map[bool]string{true: "granted", false: "denied"}[input.Granted])

	c.JSON(http.StatusOK, gin.H{"message": "Permission updated successfully", "permission": existing})
}

// auditRoleChange records role/permission-matrix edits. These change who can do
// what across the whole system and previously left no trace at all.
func auditRoleChange(c *gin.Context, action, roleKey string, oldVal, newVal interface{}, details string) {
	callerIDVal, _ := c.Get("user_id")
	callerID, _ := callerIDVal.(uint)
	utils.LogAuditWithValues(callerID, action, "role", 0, oldVal, newVal, details, c.ClientIP(), c.Request.UserAgent())
}
