package handlers

import (
	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/middleware"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Client visibility — the "Client" part of the spec's record-level layer
// (slide 16) and slide 14's "a user should never see more than the work
// explicitly assigned to them". Every logged-in user used to be able to list
// and open every client, contact details included.
//
//	FULL record (contact person, phone, email, address, notes):
//	  - super_admin and anyone with manage_clients (management — slide 10's
//	    Client 360 view is a management screen)
//	  - anyone given an explicit grant on the client (record_accesses)
//	  - the user who created the client
//	REFERENCE only (client ID, company name, city, status):
//	  - anyone who can see a project, ticket or feasibility for that client
//	    — so their own work still shows who it's for
//	Nobody else sees the client at all.
//
// Picking an existing client when raising work (slide 24) goes through
// GET /api/clients/lookup, which returns reference fields only, so staff can
// link the right client instead of creating a duplicate without being able to
// browse the client book.

func seesAllClients(c *gin.Context) bool {
	v := viewerFrom(c)
	return v.seesEverything() || middleware.HasPermission(v.Role, "manage_clients")
}

// clientFullClause: clients the viewer may see in full (beyond management).
func clientFullClause(v viewer) (string, []interface{}) {
	return "(clients.created_by_id = ? OR clients.id IN (SELECT record_id FROM record_accesses WHERE record_type = 'client' AND user_id = ?))",
		[]interface{}{v.ID, v.ID}
}

// clientScopeClause: every client the viewer may see at all (full or
// reference).
func clientScopeClause(v viewer) (string, []interface{}) {
	full, args := clientFullClause(v)
	parts := full
	add := func(table, clause string, a []interface{}) {
		sub := "clients.id IN (SELECT " + table + ".client_id FROM " + table + " WHERE " + table + ".client_id IS NOT NULL AND " + table + ".deleted_at IS NULL"
		if clause != "" {
			sub += " AND " + clause
		}
		sub += ")"
		parts += " OR " + sub
		args = append(args, a...)
	}
	pc, pa := projectScopeClause(v)
	add("projects", pc, pa)
	// Every client linked to a visible project (slide 9: several per project).
	linked := "clients.id IN (SELECT project_clients.client_id FROM project_clients JOIN projects ON projects.id = project_clients.project_id WHERE projects.deleted_at IS NULL"
	if pc != "" {
		linked += " AND " + pc
	}
	parts += " OR " + linked + ")"
	args = append(args, pa...)
	tc, ta := ticketScopeClause(v)
	add("tickets", tc, ta)
	fc, fa := feasibilityScopeClause(v)
	add("feasibilities", fc, fa)
	return "(" + parts + ")", args
}

func applyClientScope(c *gin.Context, q *gorm.DB) *gorm.DB {
	if seesAllClients(c) {
		return q
	}
	clause, args := clientScopeClause(viewerFrom(c))
	return q.Where(clause, args...)
}

// clientAccessFor decides the caller's access to one client:
// "full", "reference" or "" (none).
func clientAccessFor(c *gin.Context, cl *models.Client) string {
	if seesAllClients(c) {
		return "full"
	}
	v := viewerFrom(c)
	if v.ID == 0 {
		return ""
	}
	if cl.CreatedByID != nil && *cl.CreatedByID == v.ID {
		return "full"
	}
	if hasRecordAccess("client", cl.ID, v.ID) {
		return "full"
	}
	clause, args := clientScopeClause(v)
	var n int64
	database.DB.Model(&models.Client{}).Where("clients.id = ?", cl.ID).Where(clause, args...).Count(&n)
	if n > 0 {
		return "reference"
	}
	return ""
}

// clientRef strips a client down to the reference fields.
func clientRef(cl models.Client) models.Client {
	return models.Client{
		Model:        gorm.Model{ID: cl.ID, CreatedAt: cl.CreatedAt, UpdatedAt: cl.UpdatedAt},
		ClientNumber: cl.ClientNumber,
		CompanyName:  cl.CompanyName,
		City:         cl.City,
		Status:       cl.Status,
		AccessLevel:  "reference",
	}
}

// markClientAccess sets AccessLevel on a scoped list and strips reference-only
// rows. One query for the viewer's full-access ids, not one per client.
func markClientAccess(c *gin.Context, clients []models.Client) {
	if seesAllClients(c) {
		for i := range clients {
			clients[i].AccessLevel = "full"
		}
		return
	}
	v := viewerFrom(c)
	var fullIDs []uint
	clause, args := clientFullClause(v)
	database.DB.Model(&models.Client{}).Where(clause, args...).Pluck("clients.id", &fullIDs)
	full := map[uint]bool{}
	for _, id := range fullIDs {
		full[id] = true
	}
	for i := range clients {
		if full[clients[i].ID] {
			clients[i].AccessLevel = "full"
		} else {
			clients[i] = clientRef(clients[i])
		}
	}
}
