package handlers

import (
	"net/http"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

type CreateClientInput struct {
	CompanyName   string `json:"company_name" binding:"required"`
	ContactPerson string `json:"contact_person"`
	Email         string `json:"email"`
	Phone         string `json:"phone"`
	Website       string `json:"website"`
	Industry      string `json:"industry"`
	Address       string `json:"address"`
}

// GetClients fetches all clients, with optional cross-field search — used
// both by a future Clients management page and by the client picker in
// QuickCreateModal's project creation form.
func GetClients(c *gin.Context) {
	searchQuery := strings.TrimSpace(c.Query("search"))
	var clients []models.Client

	db := database.DB
	if searchQuery != "" {
		likeQuery := "%" + strings.ToLower(searchQuery) + "%"
		db = db.Where("LOWER(company_name) LIKE ? OR LOWER(contact_person) LIKE ? OR LOWER(email) LIKE ?", likeQuery, likeQuery, likeQuery)
	}

	if result := db.Find(&clients); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch clients: " + result.Error.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"clients": clients})
}

// CreateClient creates a new client/company profile.
func CreateClient(c *gin.Context) {
	var input CreateClientInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	client := models.Client{
		CompanyName:   input.CompanyName,
		ContactPerson: input.ContactPerson,
		Email:         input.Email,
		Phone:         input.Phone,
		Website:       input.Website,
		Industry:      input.Industry,
		Address:       input.Address,
	}

	if result := database.DB.Create(&client); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Client created successfully", "client": client})
}

// UpdateClient updates an existing client. Returns 404 if the id doesn't
// exist — consistent with every other handler in this codebase, none of
// which should ever fabricate a placeholder record for a missing id.
func UpdateClient(c *gin.Context) {
	idParam := c.Param("id")

	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	camelToSnake := map[string]string{
		"companyName":   "company_name",
		"contactPerson": "contact_person",
	}
	for camelKey, snakeKey := range camelToSnake {
		if val, ok := input[camelKey]; ok {
			input[snakeKey] = val
			delete(input, camelKey)
		}
	}

	var client models.Client
	if err := database.DB.First(&client, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Client not found"})
		return
	}

	if len(input) > 0 {
		database.DB.Model(&client).Updates(input)
	}
	database.DB.First(&client, idParam)

	c.JSON(http.StatusOK, gin.H{"message": "Client updated successfully", "client": client})
}

// DeleteClient soft-deletes a client.
func DeleteClient(c *gin.Context) {
	idParam := c.Param("id")

	var client models.Client
	if err := database.DB.First(&client, idParam).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Client already deleted"})
		return
	}

	database.DB.Delete(&client)
	c.JSON(http.StatusOK, gin.H{"message": "Client deleted successfully"})
}
