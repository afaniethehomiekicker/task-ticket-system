package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// ScopeUserManagement keeps department admins inside their own department on
// the /api/users endpoints. Put it on the users group AFTER
// RequirePermission("manage_users").
//
// Before this, anyone with manage_users (every admin, by default) could act
// on ANY non-super-admin account in the company. A CNOC admin could:
//   - reset the password of the Finance admin and sign in as them,
//   - move themselves into another department (PUT /users/<own id>),
//   - create an admin with NO department — which the visibility rules treat
//     as a company-wide admin who sees everything — then log in as it.
//
// Rules for a department admin (role admin with a department, or any other
// role granted manage_users):
//   - every /users/:id call: the target must be in the caller's department;
//   - creating a user: the department must be the caller's own (filled in
//     automatically when left empty);
//   - editing a user: the department can't be changed to another one.
//
// Super admins, and admins with no department (company-wide admins), are not
// restricted here. The handlers' existing rule that only a super admin may
// manage super admin accounts still applies on top.
func ScopeUserManagement() gin.HandlerFunc {
	return func(c *gin.Context) {
		roleVal, _ := c.Get("user_role")
		deptVal, _ := c.Get("user_department")
		role, _ := roleVal.(string)
		dept, _ := deptVal.(string)
		dept = strings.TrimSpace(dept)

		if role == "super_admin" || (role == "admin" && dept == "") {
			c.Next()
			return
		}
		if dept == "" {
			// Someone granted manage_users but with no department of their
			// own has nothing to be scoped to.
			forbidUserScope(c, "You need a department to manage users")
			return
		}

		// Any route with a target user.
		if idStr := c.Param("id"); idStr != "" {
			var target models.User
			err := database.DB.Select("id", "department").Where("id = ?", idStr).Take(&target).Error
			if err == nil && !strings.EqualFold(strings.TrimSpace(target.Department), dept) {
				forbidUserScope(c, "You can only manage users in your own department")
				return
			}
			// Not found: let the handler give its normal 404.
		}

		isCreate := c.Request.Method == http.MethodPost && c.Param("id") == ""
		isEdit := c.Request.Method == http.MethodPut && c.Param("id") != "" && !strings.HasSuffix(c.FullPath(), "/role")
		if !isCreate && !isEdit {
			c.Next()
			return
		}

		raw, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Could not read request"})
			c.Abort()
			return
		}
		restore := func(b []byte) {
			c.Request.Body = io.NopCloser(bytes.NewReader(b))
			c.Request.ContentLength = int64(len(b))
		}

		var body map[string]interface{}
		if json.Unmarshal(raw, &body) != nil || body == nil {
			// Malformed JSON: the handler rejects it with its usual message.
			restore(raw)
			c.Next()
			return
		}

		requested, _ := body["department"].(string)
		requested = strings.TrimSpace(requested)

		switch {
		case requested != "" && !strings.EqualFold(requested, dept):
			forbidUserScope(c, "You can only add or move users within your own department")
			return
		case isCreate && requested == "":
			body["department"] = dept
			if fixed, err := json.Marshal(body); err == nil {
				raw = fixed
			}
		}

		restore(raw)
		c.Next()
	}
}

func forbidUserScope(c *gin.Context, msg string) {
	c.JSON(http.StatusForbidden, gin.H{"error": msg})
	c.Abort()
}
