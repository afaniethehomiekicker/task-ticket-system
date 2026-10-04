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

// Department configuration is the Super Admin's job (spec slide 5: the Super
// Admin "configures SLA, roles, departments, notifications"). manage_departments
// is on for admins by default and used to let ANY admin add, rename or archive
// ANY department — a CNOC admin could rename Finance (moving all of Finance's
// people and work to the new name) or archive it. Adding, renaming, editing,
// archiving and restoring departments now need a super admin. Everyone can
// still READ the list (GetDepartments): every Department dropdown needs it.
func requireSuperAdminForDepartments(c *gin.Context, action string) bool {
	if viewerFrom(c).Role != "super_admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only a Super Admin can " + action + " departments"})
		return false
	}
	return true
}

// GetDepartments lists every department. Open to any authenticated user —
// same reasoning as GetClients: every role's create/edit forms need this
// list to populate a Department dropdown, not just whoever can manage it.
func GetDepartments(c *gin.Context) {
	var departments []models.Department
	// Active departments by default (every dropdown); ?status=archived lists
	// the archived ones for the Archive page.
	q := database.DB.Order("name ASC")
	if c.Query("status") == "archived" {
		q = q.Where("status = ?", "archived")
	} else {
		q = q.Where("status IS NULL OR status <> ?", "archived")
	}
	if err := q.Find(&departments).Error; err != nil {
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
	if !requireSuperAdminForDepartments(c, "add") {
		return
	}
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
		serverError(c, "Something went wrong. Please try again.", result.Error)
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
	if !requireSuperAdminForDepartments(c, "edit") {
		return
	}

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

	// Support tiers (L1..L4) only exist for a department whose name starts
	// with "CNOC" (see isSupportDepartment). Renaming it to anything else
	// would silently switch the tiers off for everyone in it.
	if renaming && isSupportDepartment(oldName) && !isSupportDepartment(newName) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "The CNOC department's name must start with \"CNOC\" — support tiers L1-L4 depend on it"})
		return
	}

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
			// Every place a department name is stored. Matched ignoring case
			// and surrounding spaces, the same way every visibility check
			// compares departments — an exact match left "cnoc" or "CNOC "
			// rows behind on the old name. The ticket's origin / returned-
			// from department (CNOC flow) were not renamed at all, so after a
			// rename the origin department lost sight of tickets it had
			// routed elsewhere.
			for _, col := range []struct {
				model  interface{}
				column string
			}{
				{&models.User{}, "department"},
				{&models.Project{}, "department"},
				{&models.Ticket{}, "department"},
				{&models.Ticket{}, "origin_department"},
				{&models.Ticket{}, "returned_from_dept"},
				{&models.Task{}, "department"},
				{&models.Feasibility{}, "assigned_dept"},
			} {
				if err := tx.Model(col.model).
					Where("LOWER(TRIM("+col.column+")) = LOWER(?)", strings.TrimSpace(oldName)).
					Update(col.column, newName).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
	if txErr != nil {
		serverError(c, "Failed to update department", txErr)
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
