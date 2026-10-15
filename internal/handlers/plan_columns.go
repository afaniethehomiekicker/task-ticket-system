package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Plan sheet column titles (the header row). Everyone sees them; only the
// Super Admin can rename them. Renaming changes the title only — the data
// and the column's meaning stay the same.
//
//	GET /api/plan-column-labels          { labels: { plan: { field_key: label } } }
//	PUT /api/plan-column-labels/:plan    { labels: { field_key: label } }   super_admin; "" = back to the built-in title

// Columns every sheet has besides its data columns.
var planMetaColumns = []string{"_ticket", "_when", "_by", "_service"}

const maxPlanColumnLabel = 60

func planColumnKeys(d *planDef) map[string]bool {
	keys := map[string]bool{}
	for _, k := range planMetaColumns {
		keys[k] = true
	}
	for _, f := range d.Fields {
		keys[f.Key] = true
	}
	if d.SecretKey != "" {
		keys[d.SecretKey] = true
	}
	return keys
}

// GetPlanColumnLabels returns every renamed column title, by plan.
func GetPlanColumnLabels(c *gin.Context) {
	var rows []models.PlanColumnLabel
	if err := database.DB.Find(&rows).Error; err != nil {
		serverError(c, "Failed to load column titles", err)
		return
	}
	out := map[string]map[string]string{}
	for _, r := range rows {
		if out[r.PlanType] == nil {
			out[r.PlanType] = map[string]string{}
		}
		out[r.PlanType][r.FieldKey] = r.Label
	}
	c.JSON(http.StatusOK, gin.H{"labels": out})
}

// SavePlanColumnLabels renames a plan's column titles (Super Admin only).
func SavePlanColumnLabels(c *gin.Context) {
	v := viewerFrom(c)
	if v.Role != "super_admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the Super Admin can rename plan columns"})
		return
	}
	def, ok := loadPlanDef(c)
	if !ok {
		return
	}
	var in struct {
		Labels map[string]string `json:"labels"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || len(in.Labels) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No column titles given"})
		return
	}
	allowed := planColumnKeys(def)
	for k, label := range in.Labels {
		if !allowed[k] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown column: " + k})
			return
		}
		label = strings.Join(strings.Fields(label), " ")
		if len([]rune(label)) > maxPlanColumnLabel {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("A column title can be at most %d characters", maxPlanColumnLabel)})
			return
		}
		in.Labels[k] = label
	}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		for k, label := range in.Labels {
			if label == "" {
				if err := tx.Where("plan_type = ? AND field_key = ?", def.Key, k).Delete(&models.PlanColumnLabel{}).Error; err != nil {
					return err
				}
				continue
			}
			row := models.PlanColumnLabel{PlanType: def.Key, FieldKey: k, Label: label, UpdatedByID: v.ID}
			if err := tx.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "plan_type"}, {Name: "field_key"}},
				DoUpdates: clause.AssignmentColumns([]string{"label", "updated_by_id", "updated_at"}),
			}).Create(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		serverError(c, "Failed to save column titles", err)
		return
	}
	utils.LogAudit(v.ID, "updated", "plan_columns", 0,
		fmt.Sprintf("Renamed %d column title(s) of the %s", len(in.Labels), def.Label), c.ClientIP(), c.Request.UserAgent())
	GetPlanColumnLabels(c)
}
