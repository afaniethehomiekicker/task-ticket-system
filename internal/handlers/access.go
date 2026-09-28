package handlers

import (
	"fmt"
	"net/http"
	"strconv"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/middleware"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Record-level access grants (spec slide 16: "Whether they were actually
// granted this specific Client / Project / Task"). Projects use their member
// list; tasks and clients use record_accesses:
//
//	GET    /api/tasks/:id/access             GET    /api/clients/:id/access
//	POST   /api/tasks/:id/access  {user_id}  POST   /api/clients/:id/access
//	DELETE /api/tasks/:id/access/:userId     DELETE /api/clients/:id/access/:userId
//
// Spec slide 6: "A Legal Admin can pull in a Technical staff member for one
// Task — without granting access to the rest of the Project." So granting
// needs grant_record_access (admins by default, configurable by the Super
// Admin), on a record the granter can fully see through their own role — a
// grant they hold themselves isn't theirs to pass on. Every grant and revoke
// is audited.

func canGrantRecordAccess(c *gin.Context) bool {
	return middleware.HasPermission(viewerFrom(c).Role, "grant_record_access")
}

// grantTarget is the record whose grants are being managed.
type grantTarget struct {
	recordType string // "task" | "client"
	id         uint
	label      string // e.g. TSK-100004 / CL-000012, for audit text
}

// loadGrantTarget loads the record named by :id and checks the caller may
// manage its grants. It has written the error response when ok is false.
func loadGrantTarget(c *gin.Context, recordType string) (grantTarget, bool) {
	if !canGrantRecordAccess(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to grant access to records"})
		return grantTarget{}, false
	}
	v := viewerFrom(c)
	switch recordType {
	case "task":
		var task models.Task
		if err := database.DB.First(&task, c.Param("id")).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
			return grantTarget{}, false
		}
		var sup *uint
		if v.Role == "supervisor" {
			sup = supervisorOf(task.AssigneeID)
		}
		if !taskVisibleTo(v, &task, sup) {
			c.JSON(http.StatusForbidden, gin.H{"error": "You can only share tasks you have access to"})
			return grantTarget{}, false
		}
		return grantTarget{"task", task.ID, task.TaskNumber}, true
	case "client":
		var client models.Client
		if err := database.DB.First(&client, c.Param("id")).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Client not found"})
			return grantTarget{}, false
		}
		owns := client.CreatedByID != nil && *client.CreatedByID == v.ID
		if !seesAllClients(c) && !owns {
			c.JSON(http.StatusForbidden, gin.H{"error": "You can only share clients you have full access to"})
			return grantTarget{}, false
		}
		return grantTarget{"client", client.ID, client.ClientNumber + " " + client.CompanyName}, true
	}
	c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported record type"})
	return grantTarget{}, false
}

func omitPassword(db *gorm.DB) *gorm.DB { return db.Omit("password") }

func listGrants(c *gin.Context, recordType string) {
	t, ok := loadGrantTarget(c, recordType)
	if !ok {
		return
	}
	var grants []models.RecordAccess
	database.DB.
		Preload("User", omitPassword).
		Preload("GrantedBy", omitPassword).
		Where("record_type = ? AND record_id = ?", t.recordType, t.id).
		Order("created_at ASC").
		Find(&grants)
	c.JSON(http.StatusOK, gin.H{"access": grants})
}

func createGrant(c *gin.Context, recordType string) {
	t, ok := loadGrantTarget(c, recordType)
	if !ok {
		return
	}
	var input struct {
		UserID uint `json:"user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id is required"})
		return
	}
	var grantee models.User
	if err := database.DB.Select("id", "name", "status").First(&grantee, input.UserID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "User not found"})
		return
	}
	if grantee.Status != "active" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "That user is deactivated"})
		return
	}
	if hasRecordAccess(t.recordType, t.id, grantee.ID) {
		c.JSON(http.StatusConflict, gin.H{"error": grantee.Name + " already has access"})
		return
	}

	grant := models.RecordAccess{
		RecordType:  t.recordType,
		RecordID:    t.id,
		UserID:      grantee.ID,
		GrantedByID: viewerFrom(c).ID,
	}
	if err := database.DB.Create(&grant).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to grant access"})
		return
	}
	utils.LogAuditWithValues(viewerFrom(c).ID, "access_granted", t.recordType, t.id,
		map[string]interface{}{}, map[string]interface{}{"user_id": grantee.ID, "user": grantee.Name},
		fmt.Sprintf("Granted %s access to %s %s", grantee.Name, t.recordType, t.label),
		c.ClientIP(), c.Request.UserAgent())

	database.DB.Preload("User", omitPassword).Preload("GrantedBy", omitPassword).First(&grant, grant.ID)
	c.JSON(http.StatusCreated, gin.H{"message": "Access granted", "access": grant})
}

func deleteGrant(c *gin.Context, recordType string) {
	t, ok := loadGrantTarget(c, recordType)
	if !ok {
		return
	}
	userID, err := strconv.ParseUint(c.Param("userId"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user id"})
		return
	}
	var grant models.RecordAccess
	if err := database.DB.Where("record_type = ? AND record_id = ? AND user_id = ?", t.recordType, t.id, userID).
		First(&grant).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "That user has no explicit access to this record"})
		return
	}
	if err := database.DB.Delete(&grant).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke access"})
		return
	}
	name := assigneeLabel(&grant.UserID)
	utils.LogAuditWithValues(viewerFrom(c).ID, "access_revoked", t.recordType, t.id,
		map[string]interface{}{"user_id": grant.UserID, "user": name}, map[string]interface{}{},
		fmt.Sprintf("Revoked %s's access to %s %s", name, t.recordType, t.label),
		c.ClientIP(), c.Request.UserAgent())
	c.JSON(http.StatusOK, gin.H{"message": "Access revoked"})
}

func GetTaskAccess(c *gin.Context)    { listGrants(c, "task") }
func GrantTaskAccess(c *gin.Context)  { createGrant(c, "task") }
func RevokeTaskAccess(c *gin.Context) { deleteGrant(c, "task") }

func GetClientAccess(c *gin.Context)    { listGrants(c, "client") }
func GrantClientAccess(c *gin.Context)  { createGrant(c, "client") }
func RevokeClientAccess(c *gin.Context) { deleteGrant(c, "client") }
