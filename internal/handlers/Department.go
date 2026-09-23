package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// New file. Spec (slide 6): "Departments are dynamic — not hard-coded,"
// listing PTA Licensing / Legal / Technical / CNOC-Support / Feasibility /
// Deployment as the CURRENT set, explicitly followed by "+ Future depts." —
// so those six are seeded as a starting point, not hard-coded into any
// dropdown. Every place in this codebase that stores a department is a
// plain string column (users.department, projects.department,
// tickets.department, tasks.department, feasibilities.assigned_dept) —
// there's no foreign key anywhere — so renaming a department here cascades
// to all five by matching the old string, in one transaction.

// EnsureDefaultDepartmentsExist seeds the six departments named in the spec
// if the table is empty. Idempotent — call it once at startup, the same way
// EnsureBuiltInRolesExist seeds the four built-in roles (role.go). Unlike
// that seeder, this ONLY runs on a genuinely empty table: once any
// department has been added, renamed, or removed, the list is fully
// admin-owned from then on, matching "not hard-coded."
func EnsureDefaultDepartmentsExist() {
	var count int64
	database.DB.Model(&models.Department{}).Count(&count)
	if count > 0 {
		return
	}
	for _, name := range []string{
		"PTA Licensing", "Legal", "Technical", "CNOC / Support", "Feasibility", "Deployment",
	} {
		database.DB.Create(&models.Department{Name: name})
	}
}

func auditDepartment(c *gin.Context, action string, id uint, oldVal, newVal interface{}, details string) {
	callerIDVal, _ := c.Get("user_id")
	callerID, _ := callerIDVal.(uint)
	utils.LogAuditWithValues(callerID, action, "department", id, oldVal, newVal, details, c.ClientIP(), c.Request.UserAgent())
}

// GetDepartments lists every department. Open to any authenticated user —
// same reasoning as GetClients: every role's create/edit forms need this
// list to populate a Department dropdown, not just whoever can manage it.
func GetDepartments(c *gin.Context) {
	var departments []models.Department
	if err := database.DB.Order("name ASC").Find(&departments).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch departments"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"departments": departments})
}

type CreateDepartmentInput struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
}

// CreateDepartment is gated by manage_departments in routes.go.
func CreateDepartment(c *gin.Context) {
	var input CreateDepartmentInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Department name cannot be empty"})
		return
	}

	var existing models.Department
	if err := database.DB.Where("LOWER(name) = LOWER(?)", name).First(&existing).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A department with that name already exists"})
		return
	}

	dept := models.Department{Name: name, Description: strings.TrimSpace(input.Description)}
	if result := database.DB.Create(&dept); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	auditDepartment(c, "department_created", dept.ID, nil, map[string]string{"name": dept.Name}, "Created department "+dept.Name)
	c.JSON(http.StatusCreated, gin.H{"message": "Department created successfully", "department": dept})
}

type UpdateDepartmentInput struct {
	Name        string  `json:"name"`
	Description *string `json:"description"`
}

// UpdateDepartment renames a department and, in the same transaction,
// updates every record that currently references the OLD name (by exact
// string match) to the new one — otherwise a rename would silently orphan
// every user/task/ticket/project/feasibility that pointed at it. Gated by
// manage_departments in routes.go.
func UpdateDepartment(c *gin.Context) {
	id := c.Param("id")

	var input UpdateDepartmentInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var dept models.Department
	if err := database.DB.First(&dept, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Department not found"})
		return
	}

	oldName := dept.Name
	newName := strings.TrimSpace(input.Name)
	renaming := newName != "" && newName != oldName

	if renaming {
		var existing models.Department
		if err := database.DB.Where("LOWER(name) = LOWER(?) AND id != ?", newName, dept.ID).First(&existing).Error; err == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "A department with that name already exists"})
			return
		}
	}

	txErr := database.DB.Transaction(func(tx *gorm.DB) error {
		updates := map[string]interface{}{}
		if renaming {
			updates["name"] = newName
		}
		if input.Description != nil {
			updates["description"] = strings.TrimSpace(*input.Description)
		}
		if len(updates) > 0 {
			if err := tx.Model(&dept).Updates(updates).Error; err != nil {
				return err
			}
		}
		if renaming {
			if err := tx.Model(&models.User{}).Where("department = ?", oldName).Update("department", newName).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.Project{}).Where("department = ?", oldName).Update("department", newName).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.Ticket{}).Where("department = ?", oldName).Update("department", newName).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.Task{}).Where("department = ?", oldName).Update("department", newName).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.Feasibility{}).Where("assigned_dept = ?", oldName).Update("assigned_dept", newName).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if txErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update department: " + txErr.Error()})
		return
	}

	if renaming {
		auditDepartment(c, "department_renamed", dept.ID,
			map[string]string{"name": oldName}, map[string]string{"name": newName},
			fmt.Sprintf("Renamed department %q to %q (cascaded to all referencing records)", oldName, newName))
	}

	database.DB.First(&dept, id)
	c.JSON(http.StatusOK, gin.H{"message": "Department updated successfully", "department": dept})
}

// DeleteDepartment refuses to delete a department that's still referenced
// anywhere, rather than silently leaving users/tasks/tickets/projects/
// feasibilities pointing at a name that no longer exists in the managed
// list — same "don't orphan a reference" discipline as DeleteRole (which
// blocks deleting a role still assigned to users). Gated by
// manage_departments in routes.go.
func DeleteDepartment(c *gin.Context) {
	id := c.Param("id")

	var dept models.Department
	if err := database.DB.First(&dept, id).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Department already deleted"})
		return
	}

	var userCount, projectCount, ticketCount, taskCount, feasibilityCount int64
	database.DB.Model(&models.User{}).Where("department = ?", dept.Name).Count(&userCount)
	database.DB.Model(&models.Project{}).Where("department = ?", dept.Name).Count(&projectCount)
	database.DB.Model(&models.Ticket{}).Where("department = ?", dept.Name).Count(&ticketCount)
	database.DB.Model(&models.Task{}).Where("department = ?", dept.Name).Count(&taskCount)
	database.DB.Model(&models.Feasibility{}).Where("assigned_dept = ?", dept.Name).Count(&feasibilityCount)

	var inUse []string
	total := userCount + projectCount + ticketCount + taskCount + feasibilityCount
	if userCount > 0 {
		inUse = append(inUse, fmt.Sprintf("%d users", userCount))
	}
	if projectCount > 0 {
		inUse = append(inUse, fmt.Sprintf("%d projects", projectCount))
	}
	if ticketCount > 0 {
		inUse = append(inUse, fmt.Sprintf("%d tickets", ticketCount))
	}
	if taskCount > 0 {
		inUse = append(inUse, fmt.Sprintf("%d tasks", taskCount))
	}
	if feasibilityCount > 0 {
		inUse = append(inUse, fmt.Sprintf("%d feasibilities", feasibilityCount))
	}
	if total > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
			"Cannot delete %q — still referenced by %s. Reassign or rename first.", dept.Name, strings.Join(inUse, ", "))})
		return
	}

	if err := database.DB.Delete(&dept).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete department"})
		return
	}

	auditDepartment(c, "department_deleted", dept.ID, map[string]string{"name": dept.Name}, nil, "Deleted department "+dept.Name)
	c.JSON(http.StatusOK, gin.H{"message": "Department deleted successfully"})
}
