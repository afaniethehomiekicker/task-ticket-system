package controllers

import (
	"net/http"
	"strconv"

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

// GetIssueByID handles fetching a single issue by its ID along with creator information
func GetIssueByID(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var issue models.Issue

		if err := db.Preload("User").First(&issue, id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				c.JSON(http.StatusNotFound, gin.H{"error": "Issue not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch issue"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"issue": issue})
	}
}

// AddComment handles posting a new comment or solution to an issue
func AddComment(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		issueID := c.Param("id")
		var input struct {
			Content string `json:"content" binding:"required"`
		}

		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		userID, exists := c.Get("user_id")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}

		parsedIssueID, err := strconv.ParseUint(issueID, 10, 32)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid issue ID"})
			return
		}

		userIDFloat, ok := userID.(float64)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user session"})
			return
		}

		comment := models.Comment{
			Content: input.Content,
			IssueID: uint(parsedIssueID),
			UserID:  uint(userIDFloat),
		}

		if err := db.Create(&comment).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add comment"})
			return
		}

		db.Preload("User").First(&comment, comment.ID)

		c.JSON(http.StatusOK, gin.H{"comment": comment})
	}
}
