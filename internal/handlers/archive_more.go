package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
)

// No hard deletes — spec slides 4 / 29: records are archived, stay visible to
// authorised management with their history, and can be restored.
//
//	DELETE /api/users/:id                    -> archive the user
//	PATCH  /api/users/:id/restore
//	DELETE /api/departments/:id              -> archive the department
//	PATCH  /api/departments/:id/restore
//	DELETE /api/feasibilities/:id/vendors/:v -> withdraw the vendor
//	PATCH  /api/feasibilities/:id/vendors/:v/reinstate

// openWorkCounts counts unfinished work assigned to a user.
func openWorkCounts(userID uint) (tasks, tickets, subtasks int64) {
	database.DB.Model(&models.Task{}).
		Where("assignee_id = ? AND status NOT IN ?", userID, statusKeysClosedOrArchived("task")).Count(&tasks)
	database.DB.Model(&models.Ticket{}).
		Where("assigned_to_id = ? AND status NOT IN ?", userID, statusKeysClosedOrArchived("ticket")).Count(&tickets)
	database.DB.Model(&models.SubTask{}).
		Where("assignee_id = ? AND status NOT IN ?", userID, []string{"done", "cancelled", "archived"}).Count(&subtasks)
	return
}

// ArchiveUser replaces the old hard delete. The account can't sign in and
// disappears from pickers and the Team list, but the person's name stays on
// all past work, timelines and audit history. Refused while they still have
// open work — reassign it first.
func ArchiveUser(c *gin.Context) {
	var target models.User
	if err := database.DB.First(&target, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	if target.ID == callerID(c) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "You can't archive your own account"})
		return
	}
	if !callerMayManage(c, target.Role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only a super admin can archive super admin accounts"})
		return
	}
	if target.Status == "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already archived"})
		return
	}
	if code, msg := roleChangeError(c, target, "archived_placeholder"); code != 0 && target.Role == "super_admin" {
		// Reuses the "last active super admin" guard.
		c.JSON(code, gin.H{"error": msg})
		return
	}
	if t, k, s := openWorkCounts(target.ID); t+k+s > 0 {
		var parts []string
		if t > 0 {
			parts = append(parts, fmt.Sprintf("%d open task(s)", t))
		}
		if k > 0 {
			parts = append(parts, fmt.Sprintf("%d open ticket(s)", k))
		}
		if s > 0 {
			parts = append(parts, fmt.Sprintf("%d open sub-task(s)", s))
		}
		c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("%s still has %s. Reassign them first.", target.Name, strings.Join(parts, ", "))})
		return
	}

	now := time.Now()
	by := callerID(c)
	if err := database.DB.Model(&target).Updates(map[string]interface{}{
		"status": "archived", "pre_archive_status": target.Status,
		"archived_at": now, "archived_by_id": by,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to archive user"})
		return
	}
	utils.LogAuditWithValues(by, "archived", "user", target.ID,
		map[string]interface{}{"status": target.Status}, map[string]interface{}{"status": "archived"},
		fmt.Sprintf("Archived user %s %s (%s)", target.UserNumber, target.Name, target.Email),
		c.ClientIP(), c.Request.UserAgent())
	c.JSON(http.StatusOK, gin.H{"message": "User archived"})
}

func RestoreUser(c *gin.Context) {
	var target models.User
	if err := database.DB.First(&target, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	if !callerMayManage(c, target.Role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only a super admin can restore super admin accounts"})
		return
	}
	if target.Status != "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only archived users can be restored"})
		return
	}
	back := target.PreArchiveStatus
	if back != "active" && back != "inactive" {
		back = "active"
	}
	if err := database.DB.Model(&target).Updates(map[string]interface{}{
		"status": back, "pre_archive_status": "", "archived_at": nil, "archived_by_id": nil,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore user"})
		return
	}
	utils.LogAuditWithValues(callerID(c), "restored", "user", target.ID,
		map[string]interface{}{"status": "archived"}, map[string]interface{}{"status": back},
		fmt.Sprintf("Restored user %s %s", target.UserNumber, target.Name), c.ClientIP(), c.Request.UserAgent())
	database.DB.First(&target, target.ID)
	c.JSON(http.StatusOK, gin.H{"message": "User restored", "user": target})
}

// ArchiveDepartment replaces the old hard delete. Refused while the
// department still has people or open work; closed history is fine — it keeps
// the department's name, so restoring reconnects everything.
func ArchiveDepartment(c *gin.Context) {
	var dept models.Department
	if err := database.DB.First(&dept, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Department not found"})
		return
	}
	if dept.Status == "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already archived"})
		return
	}
	name := dept.Name
	var users, projects, tickets, tasks, feas int64
	database.DB.Model(&models.User{}).Where("LOWER(department) = LOWER(?) AND status <> ?", name, "archived").Count(&users)
	database.DB.Model(&models.Project{}).Where("LOWER(department) = LOWER(?) AND status NOT IN ?", name,
		[]string{"completed", "cancelled", "archived"}).Count(&projects)
	database.DB.Model(&models.Ticket{}).Where("LOWER(department) = LOWER(?) AND status NOT IN ?", name,
		statusKeysClosedOrArchived("ticket")).Count(&tickets)
	database.DB.Model(&models.Task{}).Where("LOWER(department) = LOWER(?) AND status NOT IN ?", name,
		statusKeysClosedOrArchived("task")).Count(&tasks)
	database.DB.Model(&models.Feasibility{}).Where("LOWER(assigned_dept) = LOWER(?) AND status NOT IN ?", name,
		[]string{"feasible", "not_feasible", "converted", "cancelled", "archived"}).Count(&feas)
	var inUse []string
	for _, x := range []struct {
		n     int64
		label string
	}{{users, "people"}, {projects, "open projects"}, {tickets, "open tickets"}, {tasks, "open tasks"}, {feas, "open feasibilities"}} {
		if x.n > 0 {
			inUse = append(inUse, fmt.Sprintf("%d %s", x.n, x.label))
		}
	}
	if len(inUse) > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("Can't archive %q — it still has %s. Move them or finish the work first.", name, strings.Join(inUse, ", "))})
		return
	}
	now := time.Now()
	by := callerID(c)
	if err := database.DB.Model(&dept).Updates(map[string]interface{}{
		"status": "archived", "archived_at": now, "archived_by_id": by,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to archive department"})
		return
	}
	auditDepartment(c, "archived", dept.ID, map[string]string{"status": "active"}, map[string]string{"status": "archived"},
		"Archived department "+dept.DeptNumber+" "+name)
	c.JSON(http.StatusOK, gin.H{"message": "Department archived"})
}

func RestoreDepartment(c *gin.Context) {
	var dept models.Department
	if err := database.DB.First(&dept, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Department not found"})
		return
	}
	if dept.Status != "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only archived departments can be restored"})
		return
	}
	if err := database.DB.Model(&dept).Updates(map[string]interface{}{
		"status": "active", "archived_at": nil, "archived_by_id": nil,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore department"})
		return
	}
	auditDepartment(c, "restored", dept.ID, map[string]string{"status": "archived"}, map[string]string{"status": "active"},
		"Restored department "+dept.DeptNumber+" "+dept.Name)
	database.DB.First(&dept, dept.ID)
	c.JSON(http.StatusOK, gin.H{"message": "Department restored", "department": dept})
}

// MigrateSoftDeletedToArchived turns rows that were hard/soft-deleted before
// archiving existed into archived rows, so they show in the Archive and can
// be restored from the UI (no SQL needed). Idempotent; called at startup.
func MigrateSoftDeletedToArchived() {
	res := database.DB.Exec(`UPDATE departments SET status = 'archived', archived_at = deleted_at, deleted_at = NULL
		WHERE deleted_at IS NOT NULL`)
	if res.Error != nil {
		log.Printf("archive migration: departments failed: %v", res.Error)
	} else if res.RowsAffected > 0 {
		log.Printf("archive migration: %d deleted departments are now archived (restorable)", res.RowsAffected)
	}
	database.DB.Exec(`UPDATE departments SET status = 'active' WHERE status IS NULL OR status = ''`)

	res = database.DB.Exec(`UPDATE users SET status = 'archived', archived_at = deleted_at, deleted_at = NULL,
		pre_archive_status = CASE WHEN status IN ('active','inactive') THEN status ELSE 'inactive' END
		WHERE deleted_at IS NOT NULL`)
	if res.Error != nil {
		log.Printf("archive migration: users failed: %v", res.Error)
	} else if res.RowsAffected > 0 {
		log.Printf("archive migration: %d deleted users are now archived (restorable)", res.RowsAffected)
	}

	res = database.DB.Exec(`UPDATE feasibility_vendors SET withdrawn = TRUE, withdrawn_at = deleted_at, deleted_at = NULL
		WHERE deleted_at IS NOT NULL`)
	if res.Error != nil {
		log.Printf("archive migration: vendors failed: %v", res.Error)
	} else if res.RowsAffected > 0 {
		log.Printf("archive migration: %d removed vendors are now withdrawn (reinstatable)", res.RowsAffected)
	}
}
