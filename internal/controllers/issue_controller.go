package controllers

import (
	"net/http"

	"devissues/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// CreateIssue handles creating a new issue linked to the logged-in user
func CreateIssue(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input models.Issue
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Extract user_id set by the AuthMiddleware
		userID, exists := c.Get("user_id")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized user"})
			return
		}

		// Type assertion for user ID (JWT claims usually map numbers to float64)
		var uID uint
		switch v := userID.(type) {
		case int:
			uID = uint(v)
		case float64:
			uID = uint(v)
		case uint:
			uID = v
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid user ID format in token"})
			return
		}
		input.UserID = uID

		if err := db.Create(&input).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create issue"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{
			"message": "Issue created successfully",
			"issue":   input,
		})
	}
}

// GetIssues handles fetching all issues along with their creator information
func GetIssues(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var issues []models.Issue
		// Preload("User") fetches the creator details automatically via GORM
		if err := db.Preload("User").Find(&issues).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch issues"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"issues": issues})
	}
}

// GetIssueByID handles fetching a single issue by its ID along with its user details, comments, and solutions
func GetIssueByID(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var issue models.Issue

		// Fetch the issue and preload associated fields (adjust preload names if your model relationships differ)
		if err := db.Preload("User").First(&issue, id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Issue not found"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"issue": issue})
	}
}
