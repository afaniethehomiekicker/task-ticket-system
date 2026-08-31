package handlers

import (
	"fmt"
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

type CreateProjectInput struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	Deadline    string `json:"deadline"`
	OwnerID     *uint  `json:"owner_id"` // Defined as pointer
}

// Create a new project
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
		OwnerID:     input.OwnerID, // Matches *uint in models.Project
	}

	if result := database.DB.Create(&project); result.Error != nil {
		fmt.Printf("DEBUG DB ERROR: %v\n", result.Error)
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Project created successfully",
		"project": project,
	})
}

// Get all projects
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
