package handlers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Client products & services (client CRM step 2).
//
//	GET  /api/clients/:id/services               list (?status=open | closed | all, default all)
//	POST /api/clients/:id/services               add          (manage_client_services)
//	PUT  /api/clients/:id/services/:serviceId    edit / close (manage_client_services)
//
// Viewing needs full access to the client (the Client 360 rule). Services
// are never deleted: ending one means setting it to "closed". Every add and
// change is written to the client's change history (client_crm.go).

var clientServiceStatuses = map[string]string{
	"pending":   "Pending",
	"active":    "Active",
	"suspended": "Suspended",
	"closed":    "Closed",
}

var clientServiceArrangements = map[string]string{
	"through_us": "Through our company",
	"direct":     "Direct with client",
}

// Field order and labels for the change history.
var clientServiceFields = []string{"product", "location", "capacity", "vendor", "arrangement", "activation_date", "status", "ticket", "notes"}

type clientServiceInput struct {
	Product        string `json:"product"`
	Location       string `json:"location"`
	Capacity       string `json:"capacity"`
	VendorID       *uint  `json:"vendor_id"`
	VendorName     string `json:"vendor_name"`
	Arrangement    string `json:"arrangement"`
	ActivationDate string `json:"activation_date"` // YYYY-MM-DD, or "" for none
	Status         string `json:"status"`
	Ticket         string `json:"ticket"` // related ticket: number (TKT-…) or id; "" for none
	Notes          string `json:"notes"`
}

func trimTo(s string, max int) (string, bool) {
	s = strings.TrimSpace(s)
	return s, len([]rune(s)) <= max
}

// cleanServiceInput validates the input; returns a message for the user.
func cleanServiceInput(in *clientServiceInput) (activation *time.Time, msg string) {
	var ok bool
	if in.Product, ok = trimTo(in.Product, 100); !ok {
		return nil, "Product / service name is too long (max 100 characters)"
	}
	if in.Product == "" {
		return nil, "Product / service is required"
	}
	if in.Location, ok = trimTo(in.Location, 255); !ok {
		return nil, "Location is too long (max 255 characters)"
	}
	if in.Capacity, ok = trimTo(in.Capacity, 100); !ok {
		return nil, "Capacity / package is too long (max 100 characters)"
	}
	if in.VendorName, ok = trimTo(in.VendorName, 150); !ok {
		return nil, "Vendor name is too long (max 150 characters)"
	}
	if in.Notes, ok = trimTo(in.Notes, 5000); !ok {
		return nil, "Notes are too long (max 5000 characters)"
	}
	in.Status = strings.ToLower(strings.TrimSpace(in.Status))
	if in.Status == "" {
		in.Status = "pending"
	}
	if _, ok := clientServiceStatuses[in.Status]; !ok {
		return nil, "Invalid status (use pending, active, suspended or closed)"
	}
	in.Arrangement = strings.ToLower(strings.TrimSpace(in.Arrangement))
	hasVendor := (in.VendorID != nil && *in.VendorID != 0) || in.VendorName != ""
	if hasVendor {
		if _, ok := clientServiceArrangements[in.Arrangement]; !ok {
			return nil, "Choose whether the vendor service is through our company or direct with the client"
		}
	} else {
		in.Arrangement = "" // no vendor: nothing to arrange
		in.VendorID = nil
	}
	if d := strings.TrimSpace(in.ActivationDate); d != "" {
		if len(d) > 10 {
			d = d[:10] // accept a full timestamp too
		}
		t, err := time.Parse("2006-01-02", d)
		if err != nil {
			return nil, "Activation date must be a date (YYYY-MM-DD)"
		}
		activation = &t
	}
	return activation, ""
}

// serviceFieldValues is how a service reads in the change history.
func serviceFieldValues(s *models.ClientService) map[string]string {
	date := ""
	if s.ActivationDate != nil {
		date = s.ActivationDate.Format("2006-01-02")
	}
	return map[string]string{
		"product":         s.Product,
		"location":        s.Location,
		"capacity":        s.Capacity,
		"vendor":          s.VendorName,
		"arrangement":     clientServiceArrangements[s.Arrangement],
		"activation_date": date,
		"status":          clientServiceStatuses[s.Status],
		"ticket":          s.TicketNumber,
		"notes":           s.Notes,
	}
}

func serviceSummary(s *models.ClientService) string {
	parts := []string{s.ServiceNumber, s.Product}
	if s.Capacity != "" {
		parts = append(parts, s.Capacity)
	}
	if s.Location != "" {
		parts = append(parts, s.Location)
	}
	if s.VendorName != "" {
		parts = append(parts, "via "+s.VendorName)
	}
	return strings.Join(parts, " · ")
}

// applyServiceInput copies validated input onto the service, resolving the
// vendor (inside tx) and the related ticket. Returns a message for the user.
func applyServiceInput(tx *gorm.DB, c *gin.Context, clientID uint, s *models.ClientService, in clientServiceInput, activation *time.Time) string {
	s.Product = in.Product
	s.Location = in.Location
	s.Capacity = in.Capacity
	s.Arrangement = in.Arrangement
	s.ActivationDate = activation
	s.Notes = in.Notes

	// Vendor: from the shared vendor list, or a new name added to it.
	if (in.VendorID != nil && *in.VendorID != 0) || in.VendorName != "" {
		// Unchanged vendor (same id, or same name when no id given): keep it
		// even if it has since been archived.
		same := s.VendorID != nil && ((in.VendorID != nil && *in.VendorID == *s.VendorID) ||
			(in.VendorID == nil && strings.EqualFold(in.VendorName, s.VendorName)))
		if !same {
			uid := callerID(c)
			v, err := models.ResolveVendor(tx, in.VendorID, in.VendorName, &uid)
			if err != nil {
				if msg, ok := vendorErrorMessage(err); ok {
					return msg
				}
				return "Could not use that vendor"
			}
			s.VendorID = &v.ID
			s.VendorName = v.Name
		}
	} else {
		s.VendorID = nil
		s.VendorName = ""
	}

	// Related ticket (optional): must be a ticket of this client.
	if ref := strings.TrimSpace(in.Ticket); ref != "" {
		if s.TicketID == nil || !(strings.EqualFold(ref, s.TicketNumber) || ref == strconv.FormatUint(uint64(*s.TicketID), 10)) {
			t, msg := resolveClientTicket(clientID, ref)
			if msg != "" {
				return msg
			}
			s.TicketID = &t.ID
			s.TicketNumber = t.TicketNumber
		}
	} else {
		s.TicketID = nil
		s.TicketNumber = ""
	}

	// Status, with the date it was closed.
	if in.Status == "closed" && s.Status != "closed" {
		now := time.Now()
		s.ClosedAt = &now
	} else if in.Status != "closed" {
		s.ClosedAt = nil
	}
	s.Status = in.Status
	return ""
}

// relatedTicket is the service's ticket, for the history rows.
func relatedTicket(s *models.ClientService) *models.Ticket {
	if s.TicketID == nil {
		return nil
	}
	return &models.Ticket{Model: gorm.Model{ID: *s.TicketID}, TicketNumber: s.TicketNumber}
}

var errServiceInput = errors.New("invalid service input")

// GetClientServices lists a client's products & services: active first,
// then pending, suspended, closed; newest first within each.
func GetClientServices(c *gin.Context) {
	client, ok := loadCRMClient(c)
	if !ok {
		return
	}
	q := database.DB.Where("client_id = ?", client.ID)
	switch c.DefaultQuery("status", "all") {
	case "open":
		q = q.Where("status <> ?", "closed")
	case "closed":
		q = q.Where("status = ?", "closed")
	case "all":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "status must be open, closed or all"})
		return
	}
	var list []models.ClientService
	if err := q.Order("CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 WHEN 'suspended' THEN 2 ELSE 3 END, created_at DESC").
		Limit(1000).Find(&list).Error; err != nil {
		serverError(c, "Failed to load the client's services", err)
		return
	}
	if list == nil {
		list = []models.ClientService{}
	}
	// How many IP / BGP plan rows each service has (for people who may see
	// the plans): service id -> plan type -> rows.
	planCounts := map[uint]map[string]int64{}
	if canViewNetworkPlans(c) {
		var counts []struct {
			ServiceID uint
			PlanType  string
			N         int64
		}
		database.DB.Model(&models.ClientPlanRow{}).
			Select("service_id, plan_type, COUNT(*) AS n").
			Where("client_id = ? AND removed = ? AND service_id IS NOT NULL", client.ID, false).
			Group("service_id, plan_type").Scan(&counts)
		for _, row := range counts {
			if planCounts[row.ServiceID] == nil {
				planCounts[row.ServiceID] = map[string]int64{}
			}
			planCounts[row.ServiceID][row.PlanType] = row.N
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"services": list, "can_manage": canManageClientServices(c),
		"can_view_plans": canViewNetworkPlans(c), "plan_counts": planCounts,
	})
}

// CreateClientService adds a product / service to a client.
func CreateClientService(c *gin.Context) {
	client, ok := loadCRMClient(c)
	if !ok {
		return
	}
	if !canManageClientServices(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to manage client services"})
		return
	}
	var in clientServiceInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	activation, msg := cleanServiceInput(&in)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	actor := crmActorFrom(c)
	uid := actor.ID
	svc := models.ClientService{ClientID: client.ID, CreatedByID: &uid, UpdatedByID: &uid, Status: "pending"}
	var userMsg string
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if userMsg = applyServiceInput(tx, c, client.ID, &svc, in, activation); userMsg != "" {
			return errServiceInput
		}
		if err := tx.Create(&svc).Error; err != nil {
			return err
		}
		return writeClientChanges(tx, client.ID, crmRecordService, svc.ID, "created",
			[]fieldChange{{New: serviceSummary(&svc)}}, relatedTicket(&svc), actor)
	})
	if err != nil {
		if userMsg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": userMsg})
			return
		}
		serverError(c, "Failed to add the service", err)
		return
	}
	utils.LogCreated(actor.ID, "client_service", svc.ID, svc.ServiceNumber+" for "+client.CompanyName, c)
	c.JSON(http.StatusCreated, gin.H{"service": svc})
}

// UpdateClientService edits a service (all fields are sent each time).
// Closing it is just status "closed"; it can be reopened the same way.
func UpdateClientService(c *gin.Context) {
	client, ok := loadCRMClient(c)
	if !ok {
		return
	}
	if !canManageClientServices(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to manage client services"})
		return
	}
	sid, err := strconv.ParseUint(c.Param("serviceId"), 10, 64)
	if err != nil || sid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid service id"})
		return
	}
	var in clientServiceInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	activation, msg := cleanServiceInput(&in)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	actor := crmActorFrom(c)
	var svc models.ClientService
	var userMsg string
	notFound := false
	err = database.DB.Transaction(func(tx *gorm.DB) error {
		// Lock the row: two people saving the same service at once must not
		// lose each other's history.
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND client_id = ?", sid, client.ID).First(&svc).Error; err != nil {
			notFound = true
			return err
		}
		before := serviceFieldValues(&svc)
		if userMsg = applyServiceInput(tx, c, client.ID, &svc, in, activation); userMsg != "" {
			return errServiceInput
		}
		changes := diffFields(clientServiceFields, before, serviceFieldValues(&svc), nil)
		if len(changes) == 0 {
			return nil // nothing changed: nothing to save or record
		}
		uid := actor.ID
		svc.UpdatedByID = &uid
		if err := tx.Save(&svc).Error; err != nil {
			return err
		}
		return writeClientChanges(tx, client.ID, crmRecordService, svc.ID, "updated", changes, relatedTicket(&svc), actor)
	})
	if err != nil {
		switch {
		case notFound:
			c.JSON(http.StatusNotFound, gin.H{"error": "Service not found"})
		case userMsg != "":
			c.JSON(http.StatusBadRequest, gin.H{"error": userMsg})
		default:
			serverError(c, "Failed to save the service", err)
		}
		return
	}
	utils.LogUpdated(actor.ID, "client_service", svc.ID, svc.ServiceNumber+" for "+client.CompanyName, c)
	c.JSON(http.StatusOK, gin.H{"service": svc})
}

// GetServiceProducts lists every product / service name already used on a
// client service, so a product typed in once ("New product") is offered in
// the list next time. Names only — no client data.
//
//	GET /api/clients/service-products
func GetServiceProducts(c *gin.Context) {
	var names []string
	if err := database.DB.Raw(`SELECT product FROM (
			SELECT DISTINCT ON (LOWER(product)) product FROM client_services
			WHERE product <> '' ORDER BY LOWER(product), id
		) p ORDER BY LOWER(product) LIMIT 500`).Scan(&names).Error; err != nil {
		serverError(c, "Failed to load products", err)
		return
	}
	if names == nil {
		names = []string{}
	}
	c.JSON(http.StatusOK, gin.H{"products": names})
}
