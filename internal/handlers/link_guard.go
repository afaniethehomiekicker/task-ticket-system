package handlers

import (
	"bytes"
	"io"
	"net/http"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

// GuardLinkedRecords checks the records a ticket or task is being linked to,
// BEFORE the create/update handler runs. Use it on:
//
//	POST /api/tickets      (project_id, client_id, assigned_to_id)
//	PUT  /api/tickets/:id  (project_id, client_id)
//	POST /api/tasks        (ticket_id)
//
// The handlers checked that a linked project/client existed, but not that the
// caller was allowed to see it. Because the response preloads the linked
// record, linking was a way to READ a project or client you have no access
// to: create a ticket "for" project 42 and the reply contains project 42.
// CreateTicket also let anyone pre-assign a new ticket to anyone in any
// department, side-stepping the rule POST /tickets/:id/assign enforces.
//
// Kept as a separate guard (instead of edits inside ticket.go / task.go) so
// it applies cleanly whatever else has changed in those handlers.
//
// The body is decoded with gin's own JSON binding — the exact decoder the
// handlers' ShouldBindJSON uses — into fields with the same JSON names and
// types. It used to be read into a map and looked up by the exact key
// "project_id", while the handler's decoder also accepts "Project_ID",
// "PROJECT_ID", ... (encoding/json matches field names case-insensitively,
// and the last duplicate key wins). Any differently-cased key therefore
// skipped this guard but still set the link in the handler. Decoding the same
// way the handler does means this guard always checks the value the handler
// will actually use.
func GuardLinkedRecords() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Could not read request"})
			c.Abort()
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(raw))
		c.Request.ContentLength = int64(len(raw))

		var links struct {
			ProjectID    *uint `json:"project_id"`
			ClientID     *uint `json:"client_id"`
			TicketID     *uint `json:"ticket_id"`
			AssignedToID *uint `json:"assigned_to_id"`
		}
		if err := binding.JSON.BindBody(raw, &links); err != nil {
			// Malformed JSON, or a link that isn't a plain id. The handler
			// would reject it too; refusing here means nothing is ever let
			// through unchecked.
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
			c.Abort()
			return
		}

		// On an edit, only a link that actually CHANGES is checked: the edit
		// form re-sends the ticket's current project/client, and someone who
		// may work on the ticket but can't open its project must still be
		// able to save their edit.
		var current models.Ticket
		isEdit := c.Param("id") != ""
		if isEdit {
			database.DB.Select("id", "project_id", "client_id").Where("id = ?", c.Param("id")).First(&current)
		}
		unchanged := func(id uint, cur *uint) bool {
			return isEdit && cur != nil && *cur == id
		}

		if id, ok := linkedID(links.ProjectID); ok && !unchanged(id, current.ProjectID) {
			var p models.Project
			if database.DB.Where("id = ?", id).First(&p).Error != nil {
				denyLink(c, http.StatusBadRequest, "Project not found")
				return
			}
			if !userCanAccessProject(c, &p) {
				denyLink(c, http.StatusForbidden, "You don't have access to that project")
				return
			}
		}

		if id, ok := linkedID(links.ClientID); ok && !unchanged(id, current.ClientID) {
			var cl models.Client
			if database.DB.Where("id = ?", id).First(&cl).Error != nil {
				denyLink(c, http.StatusBadRequest, "Client not found")
				return
			}
			// Reference access is enough to pick a client (that is what
			// client pickers show); no access at all is not.
			if clientAccessFor(c, &cl) == "" {
				denyLink(c, http.StatusForbidden, "You don't have access to that client")
				return
			}
		}

		if id, ok := linkedID(links.TicketID); ok {
			var t models.Ticket
			if database.DB.Where("id = ?", id).First(&t).Error != nil {
				denyLink(c, http.StatusBadRequest, "Ticket not found")
				return
			}
			if !userCanAccessTicket(c, &t) {
				denyLink(c, http.StatusForbidden, "You don't have access to that ticket")
				return
			}
		}

		// Assigning while CREATING a ticket follows the same rule as
		// reassigning one: assign_tickets, or — for the person raising it,
		// who owns it at that moment — a colleague in their own department
		// (transfer_assigned_work). Assigning it to yourself is always fine.
		if c.Request.Method == http.MethodPost && strings.HasSuffix(c.FullPath(), "/tickets") {
			if target, ok := linkedID(links.AssignedToID); ok {
				v := viewerFrom(c)
				if target != v.ID && !canAssignWork(v.Role) {
					self := v.ID
					if allowed, msg := canTransferOwnWork(c, &self, &target); !allowed {
						if msg == "" {
							msg = "You don't have permission to assign tickets to other people"
						}
						denyLink(c, http.StatusForbidden, msg)
						return
					}
				}
			}
		}

		c.Next()
	}
}

// linkedID turns a decoded link into an id. Missing, null or 0 all mean
// "no link" here.
func linkedID(v *uint) (uint, bool) {
	if v == nil || *v == 0 {
		return 0, false
	}
	return *v, true
}

func denyLink(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"error": msg})
	c.Abort()
}
