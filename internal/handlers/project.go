package handlers

import (
	"fmt"
	"net/http"
	"strconv"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type CreateProjectInput struct {
	Code          string  `json:"code"`
	Title         string  `json:"title" binding:"required"`
	Description   string  `json:"description"`
	Department    string  `json:"department"`
	Status        string  `json:"status"`
	Priority      string  `json:"priority"`
	StartDate     string  `json:"start_date"`
	DueDate       string  `json:"due_date"`
	OwnerID       *uint   `json:"owner_id"`
	AdminID       *uint   `json:"admin_id"`
	MemberIDs     []uint  `json:"member_ids"`
	SupervisorIDs []uint  `json:"supervisor_ids"`
	BudgetHours   float64 `json:"budget_hours"`
	Tags          string  `json:"tags"`
}

// CreateProject creates a new project safely
func CreateProject(c *gin.Context) {
	var input CreateProjectInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	code := input.Code
	if code == "" {
		code = fmt.Sprintf("PRJ-%d", 1000+len(input.Title)) // placeholder scheme; frontend normally supplies its own code
	}

	status := input.Status
	if status == "" {
		status = "planning"
	}
	priority := input.Priority
	if priority == "" {
		priority = "normal"
	}

	project := models.Project{
		Code:        code,
		Title:       input.Title,
		Description: input.Description,
		Department:  input.Department,
		Status:      status,
		Priority:    priority,
		StartDate:   input.StartDate,
		DueDate:     input.DueDate,
		OwnerID:     input.OwnerID,
		AdminID:     input.AdminID,
		BudgetHours: input.BudgetHours,
		Tags:        input.Tags,
	}

	// Verify Owner exists before setting FK constraint to prevent DB errors
	if input.OwnerID != nil && *input.OwnerID > 0 {
		var user models.User
		if err := database.DB.First(&user, *input.OwnerID).Error; err != nil {
			project.OwnerID = nil
		}
	}

	if result := database.DB.Omit("Owner", "Admin", "Members", "Supervisors").Create(&project); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	// Members/Supervisors are many2many — not plain columns, so they can't
	// be set via the Create() call above. Passing structs with only ID
	// populated is enough for GORM to create the join-table rows without
	// needing to re-fetch each full user record; a non-zero primary key is
	// treated as "link to this existing row", not "create a new one".
	if len(input.MemberIDs) > 0 {
		members := make([]models.User, len(input.MemberIDs))
		for i, id := range input.MemberIDs {
			members[i] = models.User{Model: gorm.Model{ID: id}}
		}
		database.DB.Model(&project).Association("Members").Append(&members)
	}
	if len(input.SupervisorIDs) > 0 {
		supervisors := make([]models.User, len(input.SupervisorIDs))
		for i, id := range input.SupervisorIDs {
			supervisors[i] = models.User{Model: gorm.Model{ID: id}}
		}
		database.DB.Model(&project).Association("Supervisors").Append(&supervisors)
	}

	database.DB.Preload("Owner").Preload("Admin").Preload("Members").Preload("Supervisors").First(&project, project.ID)

	c.JSON(http.StatusCreated, gin.H{
		"message": "Project created successfully",
		"project": project,
	})
}

// GetProjects fetches all projects from DB
func GetProjects(c *gin.Context) {
	var projects []models.Project
	if result := database.DB.
		Preload("Owner").
		Preload("Admin").
		Preload("Members").
		Preload("Supervisors").
		Preload("Attachments").
		Find(&projects); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch projects"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"projects": projects,
	})
}

// UpdateProject updates an existing project. Returns 404 if the id
// doesn't exist rather than fabricating a placeholder row — this used to
// silently create a garbage "Project <id>" row with the caller-supplied
// id forced onto it as the primary key whenever the requested id wasn't
// found, exactly the same bug already fixed on the ticket handlers. A PUT
// to a nonexistent resource should 404, not invent one.
func UpdateProject(c *gin.Context) {
	idParam := c.Param("id")

	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var project models.Project
	if err := database.DB.First(&project, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}

	// Members/Supervisors are many2many associations, not plain columns —
	// a generic map-based Updates() call can't touch a join table, so
	// they're pulled out and handled explicitly via Association.Replace,
	// which fully replaces the set of linked users (matching how the
	// frontend always sends the complete member/supervisor list rather
	// than an incremental add/remove).
	if rawMemberIDs, ok := input["memberIds"]; ok {
		delete(input, "memberIds")
		if ids := toUintSlice(rawMemberIDs); ids != nil {
			members := make([]models.User, len(ids))
			for i, id := range ids {
				members[i] = models.User{Model: gorm.Model{ID: id}}
			}
			database.DB.Model(&project).Association("Members").Replace(&members)
		}
	}
	if rawSupervisorIDs, ok := input["supervisorIds"]; ok {
		delete(input, "supervisorIds")
		if ids := toUintSlice(rawSupervisorIDs); ids != nil {
			supervisors := make([]models.User, len(ids))
			for i, id := range ids {
				supervisors[i] = models.User{Model: gorm.Model{ID: id}}
			}
			database.DB.Model(&project).Association("Supervisors").Replace(&supervisors)
		}
	}

	// Normalize remaining frontend camelCase keys to their snake_case
	// column names. GORM's map-based Updates() silently no-ops on a key
	// it doesn't recognize as a column, rather than erroring — an
	// un-normalized field isn't a crash, it's a change that quietly never
	// saves.
	camelToSnake := map[string]string{
		"startDate":        "start_date",
		"dueDate":          "due_date",
		"adminId":          "admin_id",
		"ownerId":          "owner_id",
		"budgetHours":      "budget_hours",
		"spentHours":       "spent_hours",
		"isPinned":         "is_pinned",
		"progressOverride": "progress_override",
	}
	for camelKey, snakeKey := range camelToSnake {
		if val, ok := input[camelKey]; ok {
			input[snakeKey] = val
			delete(input, camelKey)
		}
	}

	if len(input) > 0 {
		// Same fix as UpdateTask in task.go: this used to call .Updates()
		// without checking its error at all, returning 200 OK regardless
		// of whether anything actually saved.
		if err := database.DB.Model(&project).Omit("Owner", "Admin", "Members", "Supervisors").Updates(input).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update project: " + err.Error()})
			return
		}
	}

	database.DB.Preload("Owner").Preload("Admin").Preload("Members").Preload("Supervisors").Preload("Attachments").First(&project, idParam)
	c.JSON(http.StatusOK, gin.H{"message": "Project updated successfully", "project": project})
}

// toUintSlice converts a JSON-decoded []interface{} into a []uint.
// Handles both float64 (the normal case — encoding/json decodes every
// JSON number as float64) and string-encoded numbers, converting either
// into a valid uint rather than silently skipping the entry. That
// leniency matters here specifically: the frontend's Add Member flow was
// briefly sending a mixed array (existing member ids as real numbers,
// the newly-picked one as a string, from a native <select>'s
// e.target.value). Before this, an element that failed the float64 type
// assertion was just dropped with no error — so Association.Replace ran
// successfully with a list that was silently missing entries, and the
// add looked like it worked while never actually attaching anyone.
// Fixed at the source on the frontend too, but this makes the endpoint
// itself robust against the same class of mistake from any caller.
func toUintSlice(raw interface{}) []uint {
	rawSlice, ok := raw.([]interface{})
	if !ok {
		return nil
	}
	ids := make([]uint, 0, len(rawSlice))
	for _, v := range rawSlice {
		switch val := v.(type) {
		case float64:
			ids = append(ids, uint(val))
		case string:
			if n, err := strconv.ParseUint(val, 10, 64); err == nil {
				ids = append(ids, uint(n))
			}
		}
	}
	return ids
}

// DeleteProject removes a project by ID gracefully
func DeleteProject(c *gin.Context) {
	idParam := c.Param("id")
	var project models.Project
	if result := database.DB.First(&project, idParam); result.Error != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Project already deleted"})
		return
	}

	if result := database.DB.Delete(&project); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete project"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Project deleted successfully"})
}
