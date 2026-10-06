package handlers

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
)

// Admin-configurable client fields — spec slide 8: "Additional fields should
// be configurable later by an authorized Admin — no schema change required
// for the business to add a new client attribute."
//
//	GET  /api/clients/fields       everyone (forms and profiles render them)
//	POST /api/clients/fields       manage_clients: add a field
//	PUT  /api/clients/fields/:id   manage_clients: rename / options / required / enable / order
//
// Values are stored per client in clients.custom_fields (jsonb) under the
// field's key. A field is never deleted — disable it instead, so values
// already recorded aren't orphaned.

var clientFieldTypes = map[string]bool{"text": true, "number": true, "date": true, "select": true}
var fieldKeyUnsafe = regexp.MustCompile(`[^a-z0-9]+`)

func splitOptions(s string) []string {
	var out []string
	for _, line := range strings.Split(strings.ReplaceAll(s, "\r", ""), "\n") {
		if t := strings.TrimSpace(line); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func GetClientFields(c *gin.Context) {
	var rows []models.ClientField
	database.DB.Order("sort_order ASC, id ASC").Find(&rows)
	c.JSON(http.StatusOK, gin.H{"fields": rows})
}

func CreateClientField(c *gin.Context) {
	var input struct {
		Label     string `json:"label" binding:"required"`
		FieldType string `json:"field_type" binding:"required"`
		Options   string `json:"options"`
		Required  bool   `json:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "label and field_type are required"})
		return
	}
	label := strings.TrimSpace(input.Label)
	if label == "" || len(label) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid label"})
		return
	}
	if !clientFieldTypes[input.FieldType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "field_type must be text, number, date or select"})
		return
	}
	if input.FieldType == "select" && len(splitOptions(input.Options)) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A dropdown field needs at least one option (one per line)"})
		return
	}
	key := strings.Trim(fieldKeyUnsafe.ReplaceAllString(strings.ToLower(label), "_"), "_")
	if key == "" || len(key) > 60 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid label"})
		return
	}
	var n int64
	database.DB.Model(&models.ClientField{}).Where("key = ?", key).Count(&n)
	if n > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "A field with that name already exists"})
		return
	}
	var maxOrder int
	database.DB.Model(&models.ClientField{}).Select("COALESCE(MAX(sort_order), 0)").Scan(&maxOrder)
	row := models.ClientField{
		Key: key, Label: label, FieldType: input.FieldType,
		Options: strings.Join(splitOptions(input.Options), "\n"),
		Required: input.Required, Enabled: true, SortOrder: maxOrder + 10,
	}
	if err := database.DB.Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add field"})
		return
	}
	utils.LogAuditWithValues(viewerFrom(c).ID, "created", "client_field", row.ID, map[string]interface{}{}, row,
		fmt.Sprintf("Added client field %q (%s)", row.Label, row.FieldType), c.ClientIP(), c.Request.UserAgent())
	c.JSON(http.StatusCreated, gin.H{"field": row})
}

func UpdateClientField(c *gin.Context) {
	var row models.ClientField
	if err := database.DB.First(&row, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Field not found"})
		return
	}
	var input struct {
		Label     *string `json:"label"`
		Options   *string `json:"options"`
		Required  *bool   `json:"required"`
		Enabled   *bool   `json:"enabled"`
		SortOrder *int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	before := row
	updates := map[string]interface{}{}
	if input.Label != nil {
		l := strings.TrimSpace(*input.Label)
		if l == "" || len(l) > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid label"})
			return
		}
		updates["label"] = l // the key never changes, so stored values stay attached
	}
	if input.Options != nil {
		opts := splitOptions(*input.Options)
		if row.FieldType == "select" && len(opts) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "A dropdown field needs at least one option"})
			return
		}
		updates["options"] = strings.Join(opts, "\n")
	}
	if input.Required != nil {
		updates["required"] = *input.Required
	}
	if input.Enabled != nil {
		updates["enabled"] = *input.Enabled
	}
	if input.SortOrder != nil {
		updates["sort_order"] = *input.SortOrder
	}
	if len(updates) > 0 {
		if err := database.DB.Model(&row).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update field"})
			return
		}
		database.DB.First(&row, row.ID)
		utils.LogAuditWithValues(viewerFrom(c).ID, "updated", "client_field", row.ID, before, row,
			fmt.Sprintf("Updated client field %q", row.Label), c.ClientIP(), c.Request.UserAgent())
	}
	c.JSON(http.StatusOK, gin.H{"field": row})
}

// validateClientCustomFields checks submitted custom values against the field
// definitions and returns the cleaned values to store. existing is the
// client's current values (nil when creating); on create every required
// field must be filled, on update a required field can't be emptied. An
// empty value removes the key.
func validateClientCustomFields(input map[string]interface{}, existing models.JSONMap) (models.JSONMap, string) {
	var defs []models.ClientField
	database.DB.Find(&defs)
	return validateClientCustomFieldsWith(defs, input, existing)
}

// validateClientCustomFieldsWith is validateClientCustomFields with the field
// definitions already loaded — the spreadsheet import checks thousands of
// rows against one set of definitions instead of reading them per row.
func validateClientCustomFieldsWith(defs []models.ClientField, input map[string]interface{}, existing models.JSONMap) (models.JSONMap, string) {
	byKey := map[string]models.ClientField{}
	for _, d := range defs {
		byKey[d.Key] = d
	}
	out := models.JSONMap{}
	for k, v := range existing {
		out[k] = v
	}
	for key, raw := range input {
		def, ok := byKey[key]
		if !ok || !def.Enabled {
			return nil, fmt.Sprintf("Unknown client field %q", key)
		}
		val := strings.TrimSpace(fmt.Sprint(raw))
		if raw == nil {
			val = ""
		}
		if val == "" {
			delete(out, key)
			continue
		}
		if len(val) > 500 {
			return nil, def.Label + " is too long"
		}
		switch def.FieldType {
		case "number":
			// Thousands separators ("1,250") are accepted.
			f, err := strconv.ParseFloat(strings.ReplaceAll(val, ",", ""), 64)
			if err != nil {
				return nil, def.Label + " must be a number"
			}
			out[key] = f
		case "date":
			if _, err := time.Parse("2006-01-02", val); err != nil {
				return nil, def.Label + " must be a date (YYYY-MM-DD)"
			}
			out[key] = val
		case "select":
			allowed := false
			// Case doesn't matter ("gold" picks "Gold"); the option's own
			// spelling is what gets stored.
			for _, o := range splitOptions(def.Options) {
				if strings.EqualFold(o, val) {
					allowed = true
					val = o
					break
				}
			}
			if !allowed {
				return nil, def.Label + ": choose one of the listed options"
			}
			out[key] = val
		default:
			out[key] = val
		}
	}
	for _, d := range defs {
		if !d.Enabled || !d.Required {
			continue
		}
		if v, ok := out[d.Key]; !ok || strings.TrimSpace(fmt.Sprint(v)) == "" {
			// On update only complain if this request tried to clear it, or
			// the client never had it — existing records created before the
			// field became required aren't blocked from unrelated edits.
			_, touched := input[d.Key]
			if existing == nil || touched {
				return nil, d.Label + " is required"
			}
		}
	}
	return out, ""
}

// cnicPattern accepts a 13-digit CNIC with or without the usual dashes
// (12345-1234567-1).
var cnicPattern = regexp.MustCompile(`^\d{5}-?\d{7}-?\d$`)

func validCNIC(s string) bool {
	s = strings.TrimSpace(s)
	return s == "" || cnicPattern.MatchString(s)
}
