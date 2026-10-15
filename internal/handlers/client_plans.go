package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Client plan sheets (client CRM steps 3–4): the IP Plan and the
// Transmission Plan, both Excel-style tables of rows per client.
//
//	GET  /api/clients/:id/plans/:plan           rows (?include_removed=1)       view_network_plans
//	POST /api/clients/:id/plans/:plan/changes   one save: add / change / remove /
//	                                            restore rows, under ONE ticket      edit_network_plans
//
// :plan is "ip" (static IP plan), "bgp" (BGP plan, shown inside the IP Plan
// tab), "transmission" (core transmission plan) or "tx_client" (client
// transmission plan; both inside the Transmission tab).
//
// The IP and BGP plans link every row to one of the client's services
// (ServiceRequired): a row can't be saved without one.
//
//	POST /api/clients/:id/plans/:plan/rows/:rowId/secret   reveal one password   view_plan_passwords
//
// A save is all-or-nothing: every row in it is written, with its history,
// or none is. It must name a ticket of this client (open or closed, not
// archived). Each row carries a version; if someone else changed a row
// since it was loaded, the whole save is refused (409) so nobody's change is
// silently overwritten.

type planField struct {
	Key   string
	Label string
	Max   int // characters
}

type planDef struct {
	Key        string // the :plan URL value
	RecordType string // client_record_changes.record_type
	Label      string
	Fields     []planField
	// The one column stored encrypted (Client.Secret), or "" for none.
	SecretKey   string
	SecretLabel string
	// Every row must name one of the client's services (service_id).
	ServiceRequired bool
}

// The service link reads as this field in the history.
const planServiceField = "service"

// Static IP plan — the columns of the team's IP plan sheet.
var ipPlanDef = planDef{
	Key:        "ip",
	RecordType: crmRecordIPPlan,
	Label:      "IP Plan",
	Fields: []planField{
		{"site_id", "Site ID", 255},
		{"gateway_end", "P2P IP Gateway End", 255},
		{"cp_end", "P2P IP CP End", 255},
		{"static_route", "Static Route", 500},
		{"interface_vlan", "Interface / VLAN", 100},
		{"capacity", "Capacity", 100},
		{"date", "Date", 50},
		{"transmission_details", "Transmission / Details", 2000},
	},
	ServiceRequired: true,
}

// BGP plan — for clients that peer with us over BGP. Prefixes can be
// several, one per line.
var bgpPlanDef = planDef{
	Key:        "bgp",
	RecordType: crmRecordBGPPlan,
	Label:      "BGP Plan",
	Fields: []planField{
		{"site_id", "Site ID", 255},
		{"vlan", "VLAN", 100},
		{"provider_end_ip", "Provider End IP", 255},
		{"our_end_ip", "Our End IP", 255},
		{"asn", "ASN", 50},
		{"prefixes", "Prefixes", 4000},
		{"as_path", "AS Path", 500},
		{"peering", "Peering", 100},
	},
	ServiceRequired: true,
}

// Core Transmission Plan — the client's core / POP devices. The password is
// the one encrypted column: it is never sent with the rows, only through
// RevealPlanSecret, and never written to the history. Not linked to a
// service. (Key "transmission" so earlier rows and links keep working.)
var transmissionPlanDef = planDef{
	Key:        "transmission",
	RecordType: crmRecordTransmissionPlan,
	Label:      "Core Transmission Plan",
	Fields: []planField{
		{"sr", "SR", 50},
		{"hostname", "Hostname", 255},
		{"mgmt_vlan_plan", "MGM-VLAN202-Plan", 255},
		{"mgmt_ip_vlan", "IP (MGM) VLAN", 255},
		{"username", "Username", 255},
		{"transmission_details", "Transmission Details", 2000},
	},
	SecretKey:   "password",
	SecretLabel: "Password",
}

// Client Transmission Plan — the client's end connections (VLAN ranges,
// user IDs, transmission paths). Every row belongs to one of the client's
// services.
var clientTransmissionPlanDef = planDef{
	Key:        "tx_client",
	RecordType: crmRecordClientTxPlan,
	Label:      "Client Transmission Plan",
	Fields: []planField{
		{"date", "Date", 50},
		{"sr", "SR", 50},
		{"vlan", "VLAN", 100},
		{"client_name", "Client Name", 255},
		{"user_id", "User-ID", 255},
		{"location", "Location", 255},
		{"transmission_a", "Transmission A", 1000},
		{"transmission_b", "Transmission B", 1000},
		{"other_details", "Other Details", 2000},
	},
	ServiceRequired: true,
}

const maxPlanSecretLength = 500

var planDefs = map[string]*planDef{
	ipPlanDef.Key:           &ipPlanDef,
	bgpPlanDef.Key:          &bgpPlanDef,
	transmissionPlanDef.Key:       &transmissionPlanDef,
	clientTransmissionPlanDef.Key: &clientTransmissionPlanDef,
}

// Columns that keep line breaks (everything else is one line).
var multilinePlanFields = map[string]bool{"other_details": true, "transmission_details": true, "prefixes": true}

const (
	maxPlanRowsPerSave = 2000
	maxPlanRowsListed  = 5000
)

// loadPlanDef reads :plan; on failure it has already answered.
func loadPlanDef(c *gin.Context) (*planDef, bool) {
	def := planDefs[c.Param("plan")]
	if def == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Unknown plan"})
		return nil, false
	}
	return def, true
}

// fieldKeys is the history order: the columns, then the secret.
func (d *planDef) fieldKeys() []string {
	out := make([]string, 0, len(d.Fields)+2)
	if d.ServiceRequired {
		out = append(out, planServiceField)
	}
	for _, f := range d.Fields {
		out = append(out, f.Key)
	}
	if d.SecretKey != "" {
		out = append(out, d.SecretKey)
	}
	return out
}

// cleanPlanData keeps the sheet's known columns, trimmed and length-checked.
// Returns a message for the user on error.
func cleanPlanData(d *planDef, in map[string]string) (map[string]string, string) {
	out := make(map[string]string, len(d.Fields))
	for _, f := range d.Fields {
		v := strings.TrimSpace(strings.ReplaceAll(in[f.Key], "\r", ""))
		if !multilinePlanFields[f.Key] {
			v = strings.Join(strings.Fields(v), " ") // single line, single spaces
		}
		if len([]rune(v)) > f.Max {
			return nil, fmt.Sprintf("%s is too long (max %d characters)", f.Label, f.Max)
		}
		out[f.Key] = v
	}
	return out, ""
}

func planDataEmpty(data map[string]string) bool {
	for _, v := range data {
		if v != "" {
			return false
		}
	}
	return true
}

// rowData reads a stored row's columns as text.
func rowData(d *planDef, r *models.ClientPlanRow) map[string]string {
	out := make(map[string]string, len(d.Fields))
	for _, f := range d.Fields {
		if v, ok := r.Data[f.Key]; ok && v != nil {
			out[f.Key] = fmt.Sprint(v)
		} else {
			out[f.Key] = ""
		}
	}
	return out
}

func toJSONMap(m map[string]string) models.JSONMap {
	out := make(models.JSONMap, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// planRowSummary is how a whole row reads in the history (add / remove).
func planRowSummary(d *planDef, data map[string]string) string {
	var parts []string
	for _, f := range d.Fields {
		if multilinePlanFields[f.Key] {
			continue
		}
		if v := data[f.Key]; v != "" {
			parts = append(parts, f.Label+": "+v)
		}
	}
	if len(parts) == 0 {
		return d.Label + " row"
	}
	s := strings.Join(parts, " · ")
	if r := []rune(s); len(r) > 500 {
		s = string(r[:500]) + "…"
	}
	return s
}

// ---- reading ------------------------------------------------------------------

type planRowView struct {
	ID            uint              `json:"id"`
	LineageID     uint              `json:"lineage_id"` // first version's id (history is kept under it)
	Superseded    bool              `json:"superseded"` // an old version: edited into the row below
	ServiceID     *uint             `json:"service_id"`
	Data          map[string]string `json:"data"`
	HasSecret     bool              `json:"has_secret"`
	Removed       bool              `json:"removed"`
	RemovedAt     *time.Time        `json:"removed_at"`
	Version       int               `json:"version"`
	TicketID      *uint             `json:"ticket_id"`
	TicketNumber  string            `json:"ticket_number"`
	UpdatedAt     time.Time         `json:"updated_at"`
	UpdatedByName string            `json:"updated_by_name"`
	CreatedAt     time.Time         `json:"created_at"`
}

func planRowViews(d *planDef, rows []models.ClientPlanRow) []planRowView {
	out := make([]planRowView, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		out = append(out, planRowView{
			ID: r.ID, LineageID: lineageOf(r), Superseded: r.SupersededByID != nil,
			ServiceID: r.ServiceID, Data: rowData(d, r), HasSecret: r.Secret != "",
			Removed: r.Removed, RemovedAt: r.RemovedAt, Version: r.Version,
			TicketID: r.TicketID, TicketNumber: r.TicketNumber,
			UpdatedAt: r.UpdatedAt, UpdatedByName: r.UpdatedByName, CreatedAt: r.CreatedAt,
		})
	}
	return out
}

// lineageOf is the id of a row's first version.
func lineageOf(r *models.ClientPlanRow) uint {
	if r.LineageID != nil {
		return *r.LineageID
	}
	return r.ID
}

func loadPlanRows(clientID uint, d *planDef, includeRemoved bool) ([]models.ClientPlanRow, error) {
	q := database.DB.Where("client_id = ? AND plan_type = ?", clientID, d.Key)
	if !includeRemoved {
		q = q.Where("removed = ?", false)
	}
	var rows []models.ClientPlanRow
	// Every version of a row together, oldest first, so an edited row's new
	// version comes right below the struck-through old one.
	err := q.Order("COALESCE(lineage_id, id) ASC, id ASC").Limit(maxPlanRowsListed).Find(&rows).Error
	return rows, err
}

func planResponse(c *gin.Context, d *planDef, rows []models.ClientPlanRow) gin.H {
	return gin.H{
		"plan":           d.Key,
		"rows":           planRowViews(d, rows),
		"can_edit":       canEditNetworkPlans(c),
		"can_view_secrets": d.SecretKey != "" && canViewPlanPasswords(c),
		"secrets_ready":  d.SecretKey == "" || secretsConfigured(),
		"truncated":      len(rows) >= maxPlanRowsListed,
	}
}

// GetClientPlan returns one plan sheet of a client.
func GetClientPlan(c *gin.Context) {
	client, ok := loadCRMClient(c)
	if !ok {
		return
	}
	def, ok := loadPlanDef(c)
	if !ok {
		return
	}
	if !canViewNetworkPlans(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have access to this client's network plans"})
		return
	}
	rows, err := loadPlanRows(client.ID, def, c.Query("include_removed") == "1")
	if err != nil {
		serverError(c, "Failed to load the plan", err)
		return
	}
	c.JSON(http.StatusOK, planResponse(c, def, rows))
}

// ---- saving -------------------------------------------------------------------

type planRowWrite struct {
	ID      uint              `json:"id"`
	Version int               `json:"version"`
	Data    map[string]string `json:"data"`
	// The client service (IP / BGP plans): required there, ignored elsewhere.
	ServiceID *uint `json:"service_id"`
	// Secret column: nil = leave as is, "" = clear, otherwise the new value.
	Secret *string `json:"secret"`
}

type planChangeInput struct {
	Ticket   string         `json:"ticket"`
	Created  []planRowWrite `json:"created"`
	Updated  []planRowWrite `json:"updated"`
	Removed  []planRowWrite `json:"removed"`
	Restored []planRowWrite `json:"restored"`
}

// planSaveError carries a status and message out of the transaction.
type planSaveError struct {
	Status    int
	Msg       string
	Conflicts []uint
}

func (e *planSaveError) Error() string { return e.Msg }

func badPlan(msg string) error { return &planSaveError{Status: http.StatusBadRequest, Msg: msg} }

// SaveClientPlanChanges applies one save to a plan sheet.
func SaveClientPlanChanges(c *gin.Context) {
	client, ok := loadCRMClient(c)
	if !ok {
		return
	}
	def, ok := loadPlanDef(c)
	if !ok {
		return
	}
	if !canEditNetworkPlans(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to edit this client's network plans"})
		return
	}
	var in planChangeInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	total := len(in.Created) + len(in.Updated) + len(in.Removed) + len(in.Restored)
	if total == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "There are no changes to save"})
		return
	}
	if total > maxPlanRowsPerSave {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Up to %d rows can be saved at once", maxPlanRowsPerSave)})
		return
	}

	// The ticket rule: no ticket, no change.
	ticket, msg := resolveClientTicket(client.ID, in.Ticket)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	// Secrets: only on a plan that has one, only for people who may see
	// them (you can't set what you can't read back), and only when the
	// server can encrypt.
	hasSecretWrites := false
	for _, list := range [][]planRowWrite{in.Created, in.Updated} {
		for _, w := range list {
			if w.Secret != nil {
				hasSecretWrites = true
			}
		}
	}
	for _, list := range [][]planRowWrite{in.Created, in.Updated} {
		for _, w := range list {
			if w.Secret == nil {
				continue
			}
			if len([]rune(*w.Secret)) > maxPlanSecretLength {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("A password can be at most %d characters", maxPlanSecretLength)})
				return
			}
			if strings.ContainsAny(*w.Secret, "\r\n") {
				c.JSON(http.StatusBadRequest, gin.H{"error": "A password can't contain line breaks"})
				return
			}
		}
	}
	if hasSecretWrites {
		switch {
		case def.SecretKey == "":
			c.JSON(http.StatusBadRequest, gin.H{"error": "This plan has no password column"})
			return
		case !canViewPlanPasswords(c):
			c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to set " + strings.ToLower(def.SecretLabel) + "s"})
			return
		case !secretsConfigured():
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": utils.ErrSecretKeyMissing.Error()})
			return
		}
	}

	// Every existing row appears once in the whole save.
	seen := map[uint]bool{}
	var existingIDs []uint
	for _, list := range [][]planRowWrite{in.Updated, in.Removed, in.Restored} {
		for _, w := range list {
			if w.ID == 0 || seen[w.ID] {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Each row can only be changed once per save"})
				return
			}
			seen[w.ID] = true
			existingIDs = append(existingIDs, w.ID)
		}
	}

	// Service link (IP / BGP plans): every new or changed row must name one
	// of THIS client's services. Labels are what the history shows.
	serviceLabels := map[uint]string{}
	if def.ServiceRequired {
		var svcs []models.ClientService
		if err := database.DB.Select("id", "service_number", "product", "capacity").
			Where("client_id = ?", client.ID).Find(&svcs).Error; err != nil {
			serverError(c, "Failed to load the client's services", err)
			return
		}
		for _, sv := range svcs {
			label := sv.ServiceNumber + " · " + sv.Product
			if sv.Capacity != "" {
				label += " · " + sv.Capacity
			}
			serviceLabels[sv.ID] = label
		}
		for i, list := range [][]planRowWrite{in.Created, in.Updated} {
			for j, w := range list {
				if w.ServiceID == nil || *w.ServiceID == 0 {
					which := fmt.Sprintf("New row %d", j+1)
					if i == 1 {
						which = "A changed row"
					}
					if i == 0 && planDataEmpty(w.Data) && (w.Secret == nil || *w.Secret == "") {
						continue // an empty new row is skipped anyway
					}
					c.JSON(http.StatusBadRequest, gin.H{"error": which + ": choose the service this row belongs to"})
					return
				}
				if _, ok := serviceLabels[*w.ServiceID]; !ok {
					c.JSON(http.StatusBadRequest, gin.H{"error": "That service doesn't belong to this client"})
					return
				}
			}
		}
	}
	serviceLabel := func(id *uint) string {
		if id == nil {
			return ""
		}
		if l, ok := serviceLabels[*id]; ok {
			return l
		}
		return fmt.Sprintf("service #%d", *id)
	}

	actor := crmActorFrom(c)
	now := time.Now()
	stamp := func(r *models.ClientPlanRow) {
		id := ticket.ID
		r.TicketID = &id
		r.TicketNumber = ticket.TicketNumber
		r.UpdatedByID = actor.ID
		r.UpdatedByName = actor.Name
	}
	counts := map[string]int{}

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		// Lock the existing rows of this save, then check versions.
		byID := map[uint]*models.ClientPlanRow{}
		if len(existingIDs) > 0 {
			var rows []models.ClientPlanRow
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id IN ? AND client_id = ? AND plan_type = ?", existingIDs, client.ID, def.Key).
				Find(&rows).Error; err != nil {
				return err
			}
			for i := range rows {
				byID[rows[i].ID] = &rows[i]
			}
		}
		var conflicts []uint
		for _, list := range [][]planRowWrite{in.Updated, in.Removed, in.Restored} {
			for _, w := range list {
				r := byID[w.ID]
				if r == nil || r.Version != w.Version {
					conflicts = append(conflicts, w.ID)
				}
			}
		}
		if len(conflicts) > 0 {
			return &planSaveError{
				Status:    http.StatusConflict,
				Msg:       fmt.Sprintf("%d row(s) were changed or removed by someone else since you opened the sheet. Reload to see their changes, then make yours again.", len(conflicts)),
				Conflicts: conflicts,
			}
		}

		// New rows.
		for i, w := range in.Created {
			data, msg := cleanPlanData(def, w.Data)
			if msg != "" {
				return badPlan(fmt.Sprintf("New row %d: %s", i+1, msg))
			}
			secret := ""
			if w.Secret != nil {
				secret = *w.Secret
			}
			if planDataEmpty(data) && secret == "" {
				continue // an empty new row is simply not saved
			}
			row := models.ClientPlanRow{
				ClientID: client.ID, PlanType: def.Key, Data: toJSONMap(data),
				Version: 1, CreatedByID: actor.ID,
			}
			summary := planRowSummary(def, data)
			if def.ServiceRequired {
				row.ServiceID = w.ServiceID
				summary = serviceLabel(w.ServiceID) + " — " + summary
			}
			if secret != "" {
				enc, err := utils.EncryptSecret(secret)
				if err != nil {
					return err
				}
				row.Secret = enc
			}
			stamp(&row)
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			if err := writeClientChanges(tx, client.ID, def.RecordType, row.ID, "created",
				[]fieldChange{{New: summary}}, ticket, actor); err != nil {
				return err
			}
			counts["added"]++
		}

		// Changed rows.
		secretMap := map[string]bool{}
		if def.SecretKey != "" {
			secretMap[def.SecretKey] = true
		}
		for _, w := range in.Updated {
			r := byID[w.ID]
			if r.Removed {
				return badPlan("A removed row can't be edited; restore it first")
			}
			data, msg := cleanPlanData(def, w.Data)
			if msg != "" {
				return badPlan(msg)
			}
			before := rowData(def, r)
			after := map[string]string{}
			for k, v := range data {
				after[k] = v
			}
			if def.ServiceRequired {
				before[planServiceField] = serviceLabel(r.ServiceID)
				after[planServiceField] = serviceLabel(w.ServiceID)
			}
			newSecret := r.Secret
			if def.SecretKey != "" {
				// Compare secrets by value without ever storing them.
				oldPlain, derr := utils.DecryptSecret(r.Secret)
				if derr != nil {
					oldPlain = "\x00unreadable"
				}
				before[def.SecretKey] = oldPlain
				after[def.SecretKey] = oldPlain
				if w.Secret != nil && *w.Secret != oldPlain {
					after[def.SecretKey] = *w.Secret
					enc, err := utils.EncryptSecret(*w.Secret)
					if err != nil {
						return err
					}
					newSecret = enc
				}
			}
			changes := diffFields(def.fieldKeys(), before, after, secretMap)
			if len(changes) == 0 {
				continue // nothing really changed
			}
			if planDataEmpty(data) && newSecret == "" {
				return badPlan("A row can't be emptied; remove it instead")
			}
			// The edit is a NEW row (the next version) right below the old
			// one, which stays, struck through. Nothing is overwritten.
			lineage := lineageOf(r)
			next := models.ClientPlanRow{
				ClientID: client.ID, PlanType: def.Key, Data: toJSONMap(data), Secret: newSecret,
				ServiceID: r.ServiceID, LineageID: &lineage, Version: 1, CreatedByID: actor.ID,
			}
			if def.ServiceRequired {
				next.ServiceID = w.ServiceID
			}
			stamp(&next)
			if err := tx.Create(&next).Error; err != nil {
				return err
			}
			r.Removed = true
			r.RemovedAt = &now
			r.SupersededByID = &next.ID
			r.Version++
			if err := tx.Save(r).Error; err != nil {
				return err
			}
			if err := writeClientChanges(tx, client.ID, def.RecordType, lineage, "updated", changes, ticket, actor); err != nil {
				return err
			}
			counts["changed"]++
		}

		// Removed rows (kept, shown struck through) and restored rows.
		for _, w := range in.Removed {
			r := byID[w.ID]
			if r.Removed {
				continue
			}
			r.Removed = true
			r.RemovedAt = &now
			r.Version++
			stamp(r)
			if err := tx.Save(r).Error; err != nil {
				return err
			}
			if err := writeClientChanges(tx, client.ID, def.RecordType, lineageOf(r), "removed",
				[]fieldChange{{Old: planRowSummary(def, rowData(def, r))}}, ticket, actor); err != nil {
				return err
			}
			counts["removed"]++
		}
		for _, w := range in.Restored {
			r := byID[w.ID]
			if !r.Removed {
				continue
			}
			if r.SupersededByID != nil {
				return badPlan("An old version of an edited row can't be restored; edit the current row instead")
			}
			r.Removed = false
			r.RemovedAt = nil
			r.Version++
			stamp(r)
			if err := tx.Save(r).Error; err != nil {
				return err
			}
			if err := writeClientChanges(tx, client.ID, def.RecordType, lineageOf(r), "restored",
				[]fieldChange{{New: planRowSummary(def, rowData(def, r))}}, ticket, actor); err != nil {
				return err
			}
			counts["restored"]++
		}
		return nil
	})
	if err != nil {
		var pe *planSaveError
		switch {
		case errors.As(err, &pe):
			body := gin.H{"error": pe.Msg}
			if len(pe.Conflicts) > 0 {
				body["conflicts"] = pe.Conflicts
			}
			c.JSON(pe.Status, body)
		case errors.Is(err, utils.ErrSecretKeyMissing):
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		default:
			serverError(c, "Failed to save the plan", err)
		}
		return
	}

	if n := counts["added"] + counts["changed"] + counts["removed"] + counts["restored"]; n > 0 {
		utils.LogAudit(actor.ID, "updated", def.RecordType, client.ID,
			fmt.Sprintf("%s of %s saved under %s: %d added, %d changed, %d removed, %d restored",
				def.Label, client.CompanyName, ticket.TicketNumber,
				counts["added"], counts["changed"], counts["removed"], counts["restored"]),
			c.ClientIP(), c.Request.UserAgent())
	}

	rows, err := loadPlanRows(client.ID, def, c.Query("include_removed") == "1")
	if err != nil {
		serverError(c, "Saved, but failed to reload the plan", err)
		return
	}
	resp := planResponse(c, def, rows)
	resp["saved"] = counts
	c.JSON(http.StatusOK, resp)
}

// RevealPlanSecret returns one row's password to someone allowed to see it.
// Each reveal is written to the audit log (who, which client / row, when).
func RevealPlanSecret(c *gin.Context) {
	client, ok := loadCRMClient(c)
	if !ok {
		return
	}
	def, ok := loadPlanDef(c)
	if !ok {
		return
	}
	if def.SecretKey == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "This plan has no password column"})
		return
	}
	if !canViewPlanPasswords(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to view passwords"})
		return
	}
	var row models.ClientPlanRow
	if err := database.DB.Where("id = ? AND client_id = ? AND plan_type = ?", c.Param("rowId"), client.ID, def.Key).
		First(&row).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Row not found"})
		return
	}
	plain, err := utils.DecryptSecret(row.Secret)
	if err != nil {
		if errors.Is(err, utils.ErrSecretKeyMissing) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "This password can't be read: " + err.Error()})
		return
	}
	actor := viewerFrom(c)
	host := rowData(def, &row)["hostname"]
	utils.LogAudit(actor.ID, "viewed_secret", def.RecordType, row.ID,
		fmt.Sprintf("Viewed the %s password of row #%d (%s) for %s", def.Label, row.ID, host, client.CompanyName),
		c.ClientIP(), c.Request.UserAgent())
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"secret": plain})
}

// GetServicePlanRows returns the plan rows linked to one client service —
// its IP Plan, BGP Plan and Client Transmission rows — for the service's
// "Plans" dropdown on the Services tab. Needs view_network_plans.
//
//	GET /api/clients/:id/services/:serviceId/plans
func GetServicePlanRows(c *gin.Context) {
	client, ok := loadCRMClient(c)
	if !ok {
		return
	}
	if !canViewNetworkPlans(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have access to this client's network plans"})
		return
	}
	var svc models.ClientService
	if err := database.DB.Select("id").Where("id = ? AND client_id = ?", c.Param("serviceId"), client.ID).
		First(&svc).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Service not found"})
		return
	}
	out := gin.H{}
	for _, def := range []*planDef{&ipPlanDef, &bgpPlanDef, &clientTransmissionPlanDef} {
		var rows []models.ClientPlanRow
		if err := database.DB.Where("client_id = ? AND plan_type = ? AND service_id = ? AND removed = ?",
			client.ID, def.Key, svc.ID, false).Order("id ASC").Limit(maxPlanRowsListed).Find(&rows).Error; err != nil {
			serverError(c, "Failed to load the service's plans", err)
			return
		}
		out[def.Key] = planRowViews(def, rows)
	}
	c.JSON(http.StatusOK, gin.H{"plans": out})
}
