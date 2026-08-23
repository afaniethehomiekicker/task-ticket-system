package controllers

import (
	"devissues/internal/models"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Add Comment to an Issue
func AddComment(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		issueID := c.Param("id")
		userID, _ := c.Get("user_id")

		var input models.Comment
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		input.IssueID = uint(issueID[0]) // simplified casting or convert properly
		// Better: use strconv.ParseUint for issueID safely:
		// parsedID, _ := strconv.ParseUint(issueID, 10, 32)
		// input.IssueID = uint(parsedID)

		input.UserID = uint(userID.(float64))

		db.Create(&input)
		db.Preload("User").First(&input, input.ID)
		c.JSON(http.StatusCreated, gin.H{"comment": input})
	}
}

// Submit a Solution to an Issue
func SubmitSolution(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		issueID := c.Param("id")
		userID, _ := c.Get("user_id")

		var input models.Solution
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		userIDFloat, ok := userID.(float64)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user session"})
			return
		}

		input.UserID = uint(userIDFloat)

		// Parse issue ID safely
		var issue models.Issue
		if err := db.First(&issue, issueID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Issue not found"})
			return
		}
		input.IssueID = issue.ID

		db.Create(&input)
		db.Preload("User").First(&input, input.ID)
		c.JSON(http.StatusCreated, gin.H{"solution": input})
	}
}

// Accept Solution (Only issue owner can accept)
func AcceptSolution(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		solutionID := c.Param("solution_id")
		userID, _ := c.Get("user_id")

		var solution models.Solution
		if err := db.First(&solution, solutionID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Solution not found"})
			return
		}

		var issue models.Issue
		if err := db.First(&issue, solution.IssueID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Associated issue not found"})
			return
		}

		// Verify that the user executing this is the author of the issue
		if issue.UserID != uint(userID.(float64)) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Only the issue creator can accept a solution"})
			return
		}

		// Mark solution as accepted
		solution.IsAccepted = true
		db.Save(&solution)

		// Update issue status to Solved
		issue.Status = "Solved"
		db.Save(&issue)

		// Award Reputation (+25 points to solution author)
		db.Create(&models.ReputationHistory{
			UserID: solution.UserID,
			Points: 25,
			Reason: "Solution accepted on issue #" + strconv.FormatUint(uint64(issue.ID), 10),
		})

		// Log Activity
		var issueOwner models.User
		db.First(&issueOwner, issue.UserID)

		db.Create(&models.Activity{
			UserID:      issue.UserID,
			Description: issueOwner.Name + " accepted a solution for issue: " + issue.Title,
		})

		c.JSON(http.StatusOK, gin.H{"message": "Solution accepted successfully, reputation updated!", "solution": solution})
	}
}

// Create Report
func CreateReport(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")

		var input models.Report
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		input.UserID = uint(userID.(float64))
		db.Create(&input)

		c.JSON(http.StatusCreated, gin.H{"message": "Content reported successfully. Admin will review it.", "report": input})
	}
}

// Get Activity Feed (Public or Protected)
func GetActivities(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var activities []models.Activity
		db.Preload("User").Order("created_at desc").Limit(20).Find(&activities)
		c.JSON(http.StatusOK, gin.H{"activities": activities})
	}
}

// Toggle Bookmark (Add / Remove)
func ToggleBookmark(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		issueIDParam := c.Param("id")
		issueID, _ := strconv.ParseUint(issueIDParam, 10, 32)
		userID, _ := c.Get("user_id")

		uID := uint(userID.(float64))
		iID := uint(issueID)

		var existing models.Bookmark
		err := db.Where("user_id = ? AND issue_id = ?", uID, iID).First(&existing).Error

		if err == nil {
			// Bookmark exists -> Delete it
			db.Delete(&existing)
			c.JSON(http.StatusOK, gin.H{"message": "Bookmark removed"})
			return
		}

		// Bookmark doesn't exist -> Create it
		bookmark := models.Bookmark{UserID: uID, IssueID: iID}
		db.Create(&bookmark)
		c.JSON(http.StatusCreated, gin.H{"message": "Issue bookmarked", "bookmark": bookmark})
	}

}
