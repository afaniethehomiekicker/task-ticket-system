package handlers

import (
	"fmt"
	"net/http"
	"strconv"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

type CreateProjectInput struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	Deadline    string `json:"deadline"`
	OwnerID     *uint  `json:"owner_id"`
}

// CreateProject creates a new project safely
func CreateProject(c *gin.Context) {
	var input CreateProjectInput
	if err := c.ShouldBindJSON(&input); err != nil {
		fmt.Printf("DEBUG BIND ERROR: %v\n", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	project := models.Project{
		Title:       input.Title,
		Description: input.Description,
		Status:      "Active",
		Deadline:    input.Deadline,
		OwnerID:     input.OwnerID,
	}

	// Verify Owner exists before setting FK constraint to prevent DB errors
	if input.OwnerID != nil && *input.OwnerID > 0 {
		var user models.User
		if err := database.DB.First(&user, *input.OwnerID).Error; err != nil {
			project.OwnerID = nil
		}
	}

	if result := database.DB.Omit("Owner").Create(&project); result.Error != nil {
		fmt.Printf("DEBUG DB ERROR: %v\n", result.Error)
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Project created successfully",
		"project": project,
	})
}

// GetProjects fetches all projects from DB
func GetProjects(c *gin.Context) {
	var projects []models.Project
	if result := database.DB.Preload("Owner").Find(&projects); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch projects"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"projects": projects,
	})
}

// UpdateProject updates an existing project or auto-creates it on the fly if missing
func UpdateProject(c *gin.Context) {
	idParam := c.Param("id")

	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var project models.Project
	if err := database.DB.First(&project, idParam).Error; err != nil {
		parsedID, _ := strconv.Atoi(idParam)
		project = models.Project{
			Title:  "Project " + idParam,
			Status: "Active",
		}
		if parsedID > 0 {
			project.ID = uint(parsedID)
		}
		database.DB.Omit("Owner").Create(&project)
	}

	database.DB.Model(&project).Updates(input)
	c.JSON(http.StatusOK, gin.H{"message": "Project updated successfully", "project": project})
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
