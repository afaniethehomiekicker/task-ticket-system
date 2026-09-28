package handlers

import (
	"fmt"
	"log"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"gorm.io/gorm"
)

// Several clients per project — spec slide 9: "A project can belong to more
// than one client, and a client can have many projects." The link table is
// project_clients; projects.client_id stays as the primary (first) client so
// everything that shows "the" client of a project keeps working.

// EnsureProjectClientLinks copies each project's existing client into the
// link table. Idempotent; called at startup.
func EnsureProjectClientLinks() {
	err := database.DB.Exec(`INSERT INTO project_clients (project_id, client_id)
		SELECT id, client_id FROM projects WHERE client_id IS NOT NULL AND deleted_at IS NULL
		ON CONFLICT DO NOTHING`).Error
	if err != nil {
		log.Printf("project clients: backfill failed: %v", err)
	}
}

// resolveProjectClients merges the request's client_ids / client_id into one
// ordered, de-duplicated list (primary first) and checks every client
// exists. allowArchived lets an edit keep a client that's already linked
// even if it has since been archived. Returns the ids or an error message.
func resolveProjectClients(primary *uint, ids []uint, allowArchived map[uint]bool) ([]uint, string) {
	seen := map[uint]bool{}
	var out []uint
	add := func(id uint) {
		if id != 0 && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	if len(ids) > 0 {
		for _, id := range ids {
			add(id)
		}
	} else if primary != nil {
		add(*primary)
	}
	if len(out) == 0 {
		return nil, ""
	}
	var found []models.Client
	database.DB.Select("id", "status", "company_name").Where("id IN ?", out).Find(&found)
	byID := map[uint]models.Client{}
	for _, cl := range found {
		byID[cl.ID] = cl
	}
	for _, id := range out {
		cl, ok := byID[id]
		if !ok {
			return nil, fmt.Sprintf("Client %d not found", id)
		}
		if cl.Status == "archived" && !allowArchived[id] {
			return nil, cl.CompanyName + " is archived"
		}
	}
	return out, ""
}

// setProjectClients replaces the project's linked clients and sets the
// primary client_id to the first one.
func setProjectClients(tx *gorm.DB, project *models.Project, ids []uint) error {
	clients := make([]models.Client, 0, len(ids))
	for _, id := range ids {
		clients = append(clients, models.Client{Model: gorm.Model{ID: id}})
	}
	if err := tx.Model(project).Association("Clients").Replace(clients); err != nil {
		return err
	}
	var primary interface{}
	if len(ids) > 0 {
		primary = ids[0]
	}
	return tx.Model(project).Update("client_id", primary).Error
}

// clientNames renders client ids as company names for audit text.
func clientNames(ids []uint) string {
	if len(ids) == 0 {
		return "none"
	}
	var rows []models.Client
	database.DB.Select("id", "company_name").Where("id IN ?", ids).Find(&rows)
	byID := map[uint]string{}
	for _, r := range rows {
		byID[r.ID] = r.CompanyName
	}
	names := make([]string, 0, len(ids))
	for _, id := range ids {
		if n := byID[id]; n != "" {
			names = append(names, n)
		} else {
			names = append(names, fmt.Sprintf("client #%d", id))
		}
	}
	return strings.Join(names, ", ")
}

// linkedClientIDs returns a project's currently linked client ids, primary
// first.
func linkedClientIDs(project *models.Project) []uint {
	var ids []uint
	database.DB.Table("project_clients").Where("project_id = ?", project.ID).Pluck("client_id", &ids)
	if project.ClientID != nil {
		out := []uint{*project.ClientID}
		for _, id := range ids {
			if id != *project.ClientID {
				out = append(out, id)
			}
		}
		return out
	}
	return ids
}
