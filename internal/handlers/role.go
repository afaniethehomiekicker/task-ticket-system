package handlers

import (
	"log"
	"net/http"
	"regexp"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/middleware"
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
	"view_internal_notes",
	"create_feasibilities",
	"grant_record_access",
	"transfer_assigned_work",
	"manage_vendors",
	"archive_records",
	// Client permissions for staff (client_edit.go): add clients, see the
	// clients admins added, and edit those for 30 minutes after the admin
	// added them (longer on an admin's approval).
	"create_clients",
	"view_admin_clients",
	"edit_admin_clients_30min",
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
	"view_internal_notes":       "View & Write Internal Notes",
	"create_feasibilities":      "Create Feasibility Requests",
	"grant_record_access":       "Grant Record Access",
	"transfer_assigned_work":    "Transfer My Work Within Department",
	"manage_vendors":            "Manage Vendor List",
	"archive_records":           "Archive & Restore Projects, Tasks & Tickets",
	"create_clients":            "Create Clients",
	"view_admin_clients":        "View Clients Added by Admins",
	"edit_admin_clients_30min":  "Edit Admin-Added Clients (30 min, then on approval)",
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
	seedClientRoles()
}

// staffClientRoles are two kinds of Staff, created once on first start:
//
//	Staff (Client Editor)  normal staff work, plus: add clients, see the
//	                       clients admins added, and edit those for 30 minutes
//	                       after the admin added them (then ask an admin)
//	Staff (Client Entry)   normal staff work, plus: add clients and see the
//	                       clients admins added
//
// Both have BaseRole "staff" and start with the Staff role's permissions as
// they are at that moment. They are ordinary roles in the matrix: a super
// admin can rename them, change their permissions or delete them, and they are
// not re-created afterwards (SeedMarker).
var staffClientRoles = []struct {
	Key, Label string
	Extra      []string
	Replaces   string // key of the earlier version of this role, if any
}{
	{"staff_client_editor", "Staff (Client Editor)", []string{"create_clients", "view_admin_clients", "edit_admin_clients_30min"}, "client_officer"},
	{"staff_client_entry", "Staff (Client Entry)", []string{"create_clients", "view_admin_clients"}, "client_data_entry"},
}

const (
	clientRolesSeedKeyV1 = "roles:client_officer_and_data_entry:v1"
	clientRolesSeedKeyV2 = "roles:staff_client_editor_and_entry:v2"
)

func seedClientRoles() {
	var marker models.SeedMarker
	if database.DB.Where("key = ?", clientRolesSeedKeyV2).Take(&marker).Error == nil {
		return
	}
	// The first version of this feature (if it was ever started) created
	// "Client Officer" / "Client Data Entry" as separate, non-staff roles.
	hadV1 := database.DB.Where("key = ?", clientRolesSeedKeyV1).Take(&marker).Error == nil

	var staffGranted []models.RolePermission
	database.DB.Where("role_key = ? AND granted = ?", "staff", true).Find(&staffGranted)

	for _, def := range staffClientRoles {
		var existing models.Role
		if database.DB.Where("key = ?", def.Key).Take(&existing).Error != nil {
			if err := database.DB.Create(&models.Role{Key: def.Key, Label: def.Label, BaseRole: "staff"}).Error; err != nil {
				log.Printf("seedClientRoles: creating %s failed: %v", def.Key, err)
				return
			}
			granted := map[string]bool{}
			for _, p := range staffGranted {
				granted[p.PermissionKey] = true
			}
			for _, p := range def.Extra {
				granted[p] = true
			}
			for _, permKey := range AllPermissionKeys {
				database.DB.Create(&models.RolePermission{RoleKey: def.Key, PermissionKey: permKey, Granted: granted[permKey]})
			}
		}
		// Move anyone on the earlier version of the role to this one, then
		// remove the earlier role.
		if hadV1 && def.Replaces != "" {
			if res := database.DB.Model(&models.User{}).Where("role = ?", def.Replaces).Update("role", def.Key); res.RowsAffected > 0 {
				log.Printf("seedClientRoles: moved %d user(s) from %s to %s", res.RowsAffected, def.Replaces, def.Key)
			}
			database.DB.Unscoped().Where("role_key = ?", def.Replaces).Delete(&models.RolePermission{})
			database.DB.Unscoped().Where("key = ?", def.Replaces).Delete(&models.Role{})
		}
	}
	// The earlier permission (edit your OWN clients) no longer exists.
	database.DB.Unscoped().Where("permission_key = ?", "edit_own_clients_30min").Delete(&models.RolePermission{})
	database.DB.Create(&models.SeedMarker{Key: clientRolesSeedKeyV2})
}

// isStaffRole: the Staff role, or a custom role built on it (BaseRole).
func isStaffRole(key string) bool {
	if key == "staff" {
		return true
	}
	if key == "" {
		return false
	}
	var n int64
	database.DB.Model(&models.Role{}).Where("key = ? AND base_role = ?", key, "staff").Count(&n)
	return n > 0
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
		"view_internal_notes":       true,
		"create_feasibilities":      true,
		"grant_record_access":       true,
		"transfer_assigned_work":    true,
		"manage_vendors":            true,
		"archive_records":           true,
		// Admins can do all of this through manage_clients anyway; granted so
		// they can also assign the staff client roles below (a role can only be
		// given by someone whose role has all of its permissions).
		"create_clients":           true,
		"view_admin_clients":       true,
		"edit_admin_clients_30min": true,
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
		"view_internal_notes":       true,
		"create_feasibilities":      true,
		"grant_record_access":       false,
		"transfer_assigned_work":    true,
		"manage_vendors":            false,
		"archive_records":           false,
		"create_clients":            false,
		"view_admin_clients":        false,
		"edit_admin_clients_30min":  false,
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
		"view_internal_notes":       false,
		"create_feasibilities":      true,
		"grant_record_access":       false,
		"transfer_assigned_work":    true,
		"manage_vendors":            false,
		"archive_records":           false,
		"create_clients":            false,
		"view_admin_clients":        false,
		"edit_admin_clients_30min":  false,
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
		serverError(c, "Something went wrong. Please try again.", result.Error)
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
	if msg := roleEditError(c, key); msg != "" {
		c.JSON(http.StatusForbidden, gin.H{"error": msg})
		return
	}

	if err := database.DB.Model(&role).Update("label", input.Label).Error; err != nil {
		serverError(c, "Failed to update role", err)
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
	if msg := roleEditError(c, key); msg != "" {
		c.JSON(http.StatusForbidden, gin.H{"error": msg})
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

	// Nobody but a super admin may change their OWN role's permissions —
	// otherwise anyone given "Settings & Matrix" could grant themselves
	// every other permission.
	if v := viewerFrom(c); v.Role != "super_admin" && v.Role == roleKey {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can't change the permissions of your own role. Ask a super admin."})
		return
	}
	// Only roles at or below the caller's own, and only permissions the
	// caller's own role has (see role_scope.go). Otherwise a matrix editor
	// could build a role above themselves and hand it to someone.
	if msg := roleEditError(c, roleKey); msg != "" {
		c.JSON(http.StatusForbidden, gin.H{"error": msg})
		return
	}
	if v := viewerFrom(c); input.Granted && !middleware.HasPermission(v.Role, permissionKey) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only grant permissions your own role has (" + permissionList([]string{permissionKey}) + ")"})
		return
	}

	var existing models.RolePermission
	err := database.DB.Where("role_key = ? AND permission_key = ?", roleKey, permissionKey).First(&existing).Error
	oldGranted := err == nil && existing.Granted
	if err != nil {
		existing = models.RolePermission{RoleKey: roleKey, PermissionKey: permissionKey, Granted: input.Granted}
		if result := database.DB.Create(&existing); result.Error != nil {
			serverError(c, "Something went wrong. Please try again.", result.Error)
			return
		}
	} else {
		if err := database.DB.Model(&existing).Update("granted", input.Granted).Error; err != nil {
			serverError(c, "Failed to update permission", err)
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
