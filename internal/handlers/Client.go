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
	ClientName    string `json:"client_name"` // slide 8: the client (person) name
	CNIC          string `json:"cnic"`        // optional; 13 digits, dashes allowed
	Mobile        string `json:"mobile"`
	// Values for admin-defined extra fields, keyed by field key.
	CustomFields map[string]interface{} `json:"custom_fields"`
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

	// Only clients the caller may see (see client_access.go). Everyone used
	// to get the whole client book.
	db := applyClientScope(c, database.DB.Model(&models.Client{}))
	if searchQuery != "" {
		likeQuery := "%" + strings.ToLower(searchQuery) + "%"
		db = db.Where("(LOWER(client_number) LIKE ? OR LOWER(company_name) LIKE ? OR LOWER(contact_person) LIKE ? OR LOWER(email) LIKE ?)", likeQuery, likeQuery, likeQuery, likeQuery)
	}
	if statusFilter != "" {
		db = db.Where("status = ?", statusFilter)
	} else {
		db = db.Where("status != ?", "archived")
	}

	if result := db.Order("company_name ASC").Find(&clients); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch clients: " + result.Error.Error()})
		return
	}
	markClientAccess(c, clients) // reference-only rows lose contact details
	c.JSON(http.StatusOK, gin.H{"clients": clients})
}

// LookupClients — GET /api/clients/lookup?search=...
//
// For client pickers when raising work (spec slide 24: staff raise
// feasibilities and link the client). Any logged-in user may search by name
// or client ID, but gets reference fields only (ID, company name, city,
// status) — enough to pick the right existing client instead of creating a
// duplicate, not enough to browse the client book. At least 2 characters,
// at most 20 results.
func LookupClients(c *gin.Context) {
	q := strings.TrimSpace(c.Query("search"))
	if len([]rune(q)) < 2 {
		c.JSON(http.StatusOK, gin.H{"clients": []models.Client{}})
		return
	}
	if r := []rune(q); len(r) > 100 {
		q = string(r[:100])
	}
	like := "%" + strings.ToLower(q) + "%"
	var found []models.Client
	if err := database.DB.
		Where("status NOT IN ?", []string{"archived"}).
		Where("(LOWER(company_name) LIKE ? OR LOWER(client_number) LIKE ?)", like, like).
		Order("company_name ASC").
		Limit(20).
		Find(&found).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Client search failed"})
		return
	}
	out := make([]models.Client, 0, len(found))
	for _, cl := range found {
		out = append(out, clientRef(cl))
	}
	c.JSON(http.StatusOK, gin.H{"clients": out})
}

func GetClient(c *gin.Context) {
	id := c.Param("id")
	var client models.Client
	if err := database.DB.First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Client not found"})
		return
	}
	switch clientAccessFor(c, &client) {
	case "full":
		client.AccessLevel = "full"
	case "reference":
		client = clientRef(client)
	default:
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
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

	// Permanent ID from the atomic counter (spec slide 7) — "highest + 1"
	// could hand the same number to two records created together.
	clientNumber, idErr := models.NextID(database.DB, "CL")
	if idErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to allocate a client ID"})
		return
	}

	if !validCNIC(input.CNIC) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "CNIC must be 13 digits (e.g. 12345-1234567-1)"})
		return
	}
	custom, msg := validateClientCustomFields(input.CustomFields, nil)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	client := models.Client{
		ClientName:    strings.TrimSpace(input.ClientName),
		CNIC:          strings.TrimSpace(input.CNIC),
		Mobile:        strings.TrimSpace(input.Mobile),
		CustomFields:  custom,
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

	// Record the creator: they can always see the client they added (e.g.
	// inline while raising a feasibility).
	if creator := callerID(c); creator != 0 {
		client.CreatedByID = &creator
	}
	if result := database.DB.Create(&client); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	auditClient(c, "created", client.ID, fmt.Sprintf("Created client %s: %s", client.ClientNumber, client.CompanyName))

	client.AccessLevel = "full"
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
		// Pointers: sending "" clears them (the fields above can't be cleared).
		ClientName   *string                `json:"client_name"`
		CNIC         *string                `json:"cnic"`
		Mobile       *string                `json:"mobile"`
		CustomFields map[string]interface{} `json:"custom_fields"`
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
	if input.ClientName != nil {
		updates["client_name"] = strings.TrimSpace(*input.ClientName)
	}
	if input.CNIC != nil {
		if !validCNIC(*input.CNIC) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "CNIC must be 13 digits (e.g. 12345-1234567-1)"})
			return
		}
		updates["cnic"] = strings.TrimSpace(*input.CNIC)
	}
	if input.Mobile != nil {
		updates["mobile"] = strings.TrimSpace(*input.Mobile)
	}
	if input.CustomFields != nil {
		custom, msg := validateClientCustomFields(input.CustomFields, client.CustomFields)
		if msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		updates["custom_fields"] = custom
	}
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

	// Archiving twice would overwrite pre_archive_status with "archived",
	// losing the status Restore needs.
	if client.Status == "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already archived"})
		return
	}

	now := time.Now()
	if err := database.DB.Model(&client).Updates(map[string]interface{}{
		"status":         "archived",
		"pre_archive_status": client.Status,
		"archived_at":    now,
		"archived_by_id": callerID,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to archive client"})
		return
	}
	auditClient(c, "archived", client.ID, fmt.Sprintf("Archived client %s: %s", client.ClientNumber, client.CompanyName))
	c.JSON(http.StatusOK, gin.H{"message": "Client archived successfully"})
}
