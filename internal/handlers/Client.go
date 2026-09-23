package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
)

// Client handlers
type CreateClientInput struct {
	CompanyName   string `json:"company_name" binding:"required"`
	ContactPerson string `json:"contact_person"`
	Email         string `json:"email"`
	Phone         string `json:"phone"`
	Website       string `json:"website"`
	Industry      string `json:"industry"`
	Address       string `json:"address"`
	City          string `json:"city"`
	Country       string `json:"country"`
	Notes         string `json:"notes"`
	Status        string `json:"status"`
}

// GetClients excludes archived clients by default, same convention as
// GetProjects/GetTasks/GetTickets/GetFeasibilities — reachable via
// ?status=archived, never truly hidden.
func GetClients(c *gin.Context) {
	searchQuery := strings.TrimSpace(c.Query("search"))
	statusFilter := strings.TrimSpace(c.Query("status"))
	var clients []models.Client

	db := database.DB
	if searchQuery != "" {
		likeQuery := "%" + strings.ToLower(searchQuery) + "%"
		db = db.Where("LOWER(client_number) LIKE ? OR LOWER(company_name) LIKE ? OR LOWER(contact_person) LIKE ? OR LOWER(email) LIKE ?", likeQuery, likeQuery, likeQuery, likeQuery)
	}
	if statusFilter != "" {
		db = db.Where("status = ?", statusFilter)
	} else {
		db = db.Where("status != ?", "archived")
	}

	if result := db.Find(&clients); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch clients: " + result.Error.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"clients": clients})
}

func GetClient(c *gin.Context) {
	id := c.Param("id")
	var client models.Client
	if err := database.DB.First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Client not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"client": client})
}

// CreateClient generates a permanent ClientNumber (CL-000001 style),
// matching the pattern already used for Task/Ticket/Feasibility.
// Previously this was never set at all — since models.go's ClientNumber
// has a unique index, every client after the first would have collided
// on the shared empty-string value and failed outright.
func CreateClient(c *gin.Context) {
	var input CreateClientInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.Status != "" && input.Status != "active" && input.Status != "inactive" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid client status"})
		return
	}

	var maxNum int
	database.DB.Unscoped().Model(&models.Client{}).
		Where("client_number ~ '^CL-[0-9]+$'").
		Select("COALESCE(MAX(CAST(SUBSTRING(client_number FROM 4) AS INTEGER)), 0)").
		Scan(&maxNum)
	clientNumber := fmt.Sprintf("CL-%06d", maxNum+1)

	client := models.Client{
		ClientNumber:  clientNumber,
		CompanyName:   input.CompanyName,
		ContactPerson: input.ContactPerson,
		Email:         input.Email,
		Phone:         input.Phone,
		Website:       input.Website,
		Industry:      input.Industry,
		Address:       input.Address,
		City:          input.City,
		Country:       input.Country,
		Notes:         input.Notes,
		Status:        input.Status,
	}

	if client.Status == "" {
		client.Status = "active"
	}

	if result := database.DB.Create(&client); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	auditClient(c, "created", client.ID, fmt.Sprintf("Created client %s: %s", client.ClientNumber, client.CompanyName))

	c.JSON(http.StatusCreated, gin.H{"message": "Client created successfully", "client": client})
}

func UpdateClient(c *gin.Context) {
	id := c.Param("id")

	var input struct {
		CompanyName   string `json:"company_name"`
		ContactPerson string `json:"contact_person"`
		Email         string `json:"email"`
		Phone         string `json:"phone"`
		Website       string `json:"website"`
		Industry      string `json:"industry"`
		Address       string `json:"address"`
		City          string `json:"city"`
		Country       string `json:"country"`
		Notes         string `json:"notes"`
		Status        string `json:"status"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var client models.Client
	if err := database.DB.First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Client not found"})
		return
	}

	updates := map[string]interface{}{}
	if input.CompanyName != "" {
		updates["company_name"] = input.CompanyName
	}
	if input.ContactPerson != "" {
		updates["contact_person"] = input.ContactPerson
	}
	if input.Email != "" {
		updates["email"] = input.Email
	}
	if input.Phone != "" {
		updates["phone"] = input.Phone
	}
	if input.Website != "" {
		updates["website"] = input.Website
	}
	if input.Industry != "" {
		updates["industry"] = input.Industry
	}
	if input.Address != "" {
		updates["address"] = input.Address
	}
	if input.City != "" {
		updates["city"] = input.City
	}
	if input.Country != "" {
		updates["country"] = input.Country
	}
	if input.Notes != "" {
		updates["notes"] = input.Notes
	}
	if input.Status != "" {
		// "archived" deliberately excluded — same rule as Project/Task/
		// Ticket/Feasibility: only DeleteClient's path can set it.
		if input.Status == "archived" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Use the archive/delete action to archive a client"})
			return
		}
		if input.Status != "active" && input.Status != "inactive" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid client status"})
			return
		}
		updates["status"] = input.Status
	}

	if len(updates) > 0 {
		if err := database.DB.Model(&client).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update client"})
			return
		}
		fields := make([]string, 0, len(updates))
		for k := range updates {
			fields = append(fields, k)
		}
		auditClient(c, "updated", client.ID, fmt.Sprintf("Updated client %s: fields %s", client.ClientNumber, strings.Join(fields, ", ")))
	}

	database.DB.First(&client, id)
	c.JSON(http.StatusOK, gin.H{"client": client})
}

// auditClient records a client action against the real caller. Client changes
// weren't audited at all.
func auditClient(c *gin.Context, action string, clientID uint, details string) {
	callerIDVal, _ := c.Get("user_id")
	callerID, _ := callerIDVal.(uint)
	utils.LogAudit(callerID, action, "client", clientID, details, c.ClientIP(), c.Request.UserAgent())
}

// DeleteClient archives a client — see the matching comment on
// DeleteProject in projects.go for why this replaces GORM soft-delete. It now
// records who archived it (ArchivedByID was always left nil) and audits it.
func DeleteClient(c *gin.Context) {
	id := c.Param("id")

	var client models.Client
	if err := database.DB.First(&client, id).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Client already deleted"})
		return
	}

	callerIDVal, _ := c.Get("user_id")
	callerID, _ := callerIDVal.(uint)

	now := time.Now()
	if err := database.DB.Model(&client).Updates(map[string]interface{}{
		"status":         "archived",
		"archived_at":    now,
		"archived_by_id": callerID,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to archive client"})
		return
	}
	auditClient(c, "archived", client.ID, fmt.Sprintf("Archived client %s: %s", client.ClientNumber, client.CompanyName))
	c.JSON(http.StatusOK, gin.H{"message": "Client archived successfully"})
}
