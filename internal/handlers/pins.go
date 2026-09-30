package handlers

import (
	"net/http"
	"strconv"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// Per-person pins — spec slide 28 ("Pinned Items" on the dashboard).
//
//	GET    /api/pins                  the caller's pins
//	PUT    /api/pins/:type/:id        pin
//	DELETE /api/pins/:type/:id        unpin
//
// A pin only reorders / highlights something the caller can already open;
// the record itself stays governed by its own access rules.

var pinnableTypes = map[string]bool{"project": true, "task": true, "ticket": true, "feasibility": true, "client": true}

func pinTarget(c *gin.Context) (string, uint, bool) {
	t := c.Param("type")
	if !pinnableTypes[t] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Can't pin that kind of record"})
		return "", 0, false
	}
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid id"})
		return "", 0, false
	}
	return t, uint(id), true
}

func GetPins(c *gin.Context) {
	var pins []models.Pin
	database.DB.Where("user_id = ?", viewerFrom(c).ID).Order("created_at DESC").Find(&pins)
	c.JSON(http.StatusOK, gin.H{"pins": pins})
}

func AddPin(c *gin.Context) {
	t, id, ok := pinTarget(c)
	if !ok {
		return
	}
	pin := models.Pin{UserID: viewerFrom(c).ID, RecordType: t, RecordID: id}
	if err := database.DB.Where(pin).FirstOrCreate(&pin).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to pin"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"pin": pin})
}

func RemovePin(c *gin.Context) {
	t, id, ok := pinTarget(c)
	if !ok {
		return
	}
	database.DB.Where("user_id = ? AND record_type = ? AND record_id = ?", viewerFrom(c).ID, t, id).Delete(&models.Pin{})
	c.JSON(http.StatusOK, gin.H{"message": "Unpinned"})
}

// MigrateSharedPins converts the old shared pin flags. Pinning a record for
// everyone who can see it would pin things for people who never chose to, so
// each old flag becomes a pin for the record's creator — the closest record
// of "whoever pinned it". Idempotent; called at startup.
func MigrateSharedPins() {
	database.DB.Exec(`INSERT INTO pins (created_at, user_id, record_type, record_id)
		SELECT now(), creator_id, 'task', id FROM tasks WHERE is_pinned AND creator_id IS NOT NULL
		ON CONFLICT DO NOTHING`)
	database.DB.Exec(`INSERT INTO pins (created_at, user_id, record_type, record_id)
		SELECT now(), created_by_id, 'ticket', id FROM tickets WHERE is_pinned AND created_by_id IS NOT NULL
		ON CONFLICT DO NOTHING`)
	database.DB.Exec(`UPDATE tasks SET is_pinned = FALSE WHERE is_pinned`)
	database.DB.Exec(`UPDATE tickets SET is_pinned = FALSE WHERE is_pinned`)
}
