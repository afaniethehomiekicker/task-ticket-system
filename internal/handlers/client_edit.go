package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/middleware"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// Who may edit a client:
//
//   - the super admin and anyone with manage_clients: any client, any time;
//   - staff whose role has edit_admin_clients_30min (the "Staff (Client
//     Editor)" role): a client an Admin or the Super Admin added, for 30
//     minutes after it was added. After that they send an edit request; when
//     a Super Admin or Admin approves it they can edit that client again for
//     the time the approver chose (30 minutes, 2 hours or 24 hours).
//
// Clients a staff member added themselves stay as before (not editable by
// them). The server enforces all of this on every update (UpdateClient); the
// can_edit / edit_until / edit_request fields on each client only tell the
// screen which button to show.
//
//	POST /api/clients/:id/edit-requests          ask for edit access (reason)
//	GET  /api/clients/edit-requests?status=...   approvers: everyone's; others: their own
//	POST /api/clients/edit-requests/:id/approve  {minutes, note}   (manage_clients)
//	POST /api/clients/edit-requests/:id/reject   {note}            (manage_clients)

// AdminClientEditWindow is how long after an Admin / Super Admin adds a client
// that staff with edit_admin_clients_30min may edit it without asking.
const AdminClientEditWindow = 30 * time.Minute

const editAdminClientsPerm = "edit_admin_clients_30min"

// editRequestDurations are the lengths of access an approver can give.
var editRequestDurations = map[int]string{
	30:   "30 minutes",
	120:  "2 hours",
	1440: "24 hours",
}

const (
	editRequestPending  = "pending"
	editRequestApproved = "approved"
	editRequestRejected = "rejected"
)

// managesClients: may edit any client and decide edit requests.
func managesClients(v viewer) bool {
	return v.seesEverything() || middleware.HasPermission(v.Role, "manage_clients")
}

// clientEditState is the caller's edit access to one client.
type clientEditState struct {
	Allowed bool
	Until   *time.Time // when Allowed ends (nil = no limit)
	Pending bool       // the caller has a pending edit request for it
	// Why not allowed: "window_closed" (may request access) or "no_permission".
	Reason string
}

// activeGrantUntil returns when the caller's approved access to the client
// ends, if it hasn't yet.
func activeGrantUntil(clientID, userID uint, now time.Time) *time.Time {
	var req models.ClientEditRequest
	err := database.DB.Where("client_id = ? AND requester_id = ? AND status = ? AND expires_at > ?",
		clientID, userID, editRequestApproved, now).Order("expires_at DESC").Take(&req).Error
	if err != nil {
		return nil
	}
	return req.ExpiresAt
}

func hasPendingEditRequest(clientID, userID uint) bool {
	var n int64
	database.DB.Model(&models.ClientEditRequest{}).
		Where("client_id = ? AND requester_id = ? AND status = ?", clientID, userID, editRequestPending).Count(&n)
	return n > 0
}

// clientEditStateFor decides the caller's edit access to one client.
func clientEditStateFor(v viewer, cl *models.Client, now time.Time) clientEditState {
	if cl.Status == "archived" {
		return clientEditState{Reason: "no_permission"}
	}
	if managesClients(v) {
		return clientEditState{Allowed: true}
	}
	if !middleware.HasPermission(v.Role, editAdminClientsPerm) || !createdByAdmin(cl.CreatedByID) {
		return clientEditState{Reason: "no_permission"}
	}
	windowEnd := cl.CreatedAt.Add(AdminClientEditWindow)
	if now.Before(windowEnd) {
		return clientEditState{Allowed: true, Until: &windowEnd}
	}
	if until := activeGrantUntil(cl.ID, v.ID, now); until != nil {
		return clientEditState{Allowed: true, Until: until}
	}
	return clientEditState{Reason: "window_closed", Pending: hasPendingEditRequest(cl.ID, v.ID)}
}

// adminCreators returns which of the given creator ids are an Admin or the
// Super Admin (one query).
func adminCreators(ids []uint) map[uint]bool {
	out := map[uint]bool{}
	if len(ids) == 0 {
		return out
	}
	var admins []uint
	database.DB.Unscoped().Model(&models.User{}).
		Where("id IN ? AND role IN ('admin', 'super_admin')", ids).Pluck("id", &admins)
	for _, id := range admins {
		out[id] = true
	}
	return out
}

// markClientEdit sets can_edit / edit_until / edit_request on a list of
// clients for the caller. edit_request is "available" when the caller may
// ask for edit access and "pending" when they have asked. Three queries for
// the whole list.
func markClientEdit(c *gin.Context, clients []models.Client) {
	v := viewerFrom(c)
	now := time.Now()
	if managesClients(v) {
		for i := range clients {
			clients[i].CanEdit = clients[i].Status != "archived"
		}
		return
	}
	if !middleware.HasPermission(v.Role, editAdminClientsPerm) {
		return
	}
	seen := map[uint]bool{}
	var creatorIDs []uint
	for _, cl := range clients {
		if cl.CreatedByID != nil && !seen[*cl.CreatedByID] {
			seen[*cl.CreatedByID] = true
			creatorIDs = append(creatorIDs, *cl.CreatedByID)
		}
	}
	byAdmin := adminCreators(creatorIDs)

	// The caller's own waiting requests and running approvals (few rows).
	var reqs []models.ClientEditRequest
	database.DB.Where("requester_id = ? AND (status = ? OR (status = ? AND expires_at > ?))",
		v.ID, editRequestPending, editRequestApproved, now).Find(&reqs)
	grantUntil := map[uint]time.Time{}
	pending := map[uint]bool{}
	for _, r := range reqs {
		if r.Status == editRequestPending {
			pending[r.ClientID] = true
		} else if r.ExpiresAt != nil && r.ExpiresAt.After(grantUntil[r.ClientID]) {
			grantUntil[r.ClientID] = *r.ExpiresAt
		}
	}
	for i := range clients {
		cl := &clients[i]
		if cl.CreatedByID == nil || !byAdmin[*cl.CreatedByID] || cl.Status == "archived" {
			continue
		}
		windowEnd := cl.CreatedAt.Add(AdminClientEditWindow)
		switch {
		case now.Before(windowEnd):
			cl.CanEdit, cl.EditUntil = true, &windowEnd
		case !grantUntil[cl.ID].IsZero():
			until := grantUntil[cl.ID]
			cl.CanEdit, cl.EditUntil = true, &until
		case pending[cl.ID]:
			cl.EditRequest = editRequestPending
		default:
			cl.EditRequest = "available"
		}
	}
}

// markOneClientEdit is markClientEdit for a single client.
func markOneClientEdit(c *gin.Context, cl *models.Client) {
	list := []models.Client{*cl}
	markClientEdit(c, list)
	cl.CanEdit, cl.EditUntil, cl.EditRequest = list[0].CanEdit, list[0].EditUntil, list[0].EditRequest
}

// clientEditDenied writes the 403 for a refused client update.
func clientEditDenied(c *gin.Context, st clientEditState) {
	if st.Reason == "window_closed" {
		msg := "The 30 minutes for editing this client have passed. Send an edit request to an admin to change it."
		if st.Pending {
			msg = "The 30 minutes for editing this client have passed. Your edit request is waiting for an admin."
		}
		c.JSON(http.StatusForbidden, gin.H{"error": msg, "code": "edit_window_closed"})
		return
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to edit this client", "code": "no_permission"})
}

// ---- Requests -----------------------------------------------------------------

type editRequestView struct {
	ID            uint       `json:"id"`
	CreatedAt     time.Time  `json:"created_at"`
	ClientID      uint       `json:"client_id"`
	ClientNumber  string     `json:"client_number"`
	CompanyName   string     `json:"company_name"`
	RequesterID   uint       `json:"requester_id"`
	RequesterName string     `json:"requester_name"`
	Reason        string     `json:"reason"`
	Status        string     `json:"status"`
	DecidedByID   *uint      `json:"decided_by_id,omitempty"`
	DecidedByName string     `json:"decided_by_name,omitempty"`
	DecidedAt     *time.Time `json:"decided_at,omitempty"`
	DecisionNote  string     `json:"decision_note,omitempty"`
	AccessMinutes int        `json:"access_minutes,omitempty"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
}

// editRequestViews adds client and people names to requests (three queries).
func editRequestViews(reqs []models.ClientEditRequest) []editRequestView {
	clientIDs, userIDs := []uint{}, []uint{}
	for _, r := range reqs {
		clientIDs = append(clientIDs, r.ClientID)
		userIDs = append(userIDs, r.RequesterID)
		if r.DecidedByID != nil {
			userIDs = append(userIDs, *r.DecidedByID)
		}
	}
	clients := map[uint]models.Client{}
	names := map[uint]string{}
	if len(reqs) > 0 {
		var cl []models.Client
		database.DB.Unscoped().Select("id", "client_number", "company_name").Where("id IN ?", clientIDs).Find(&cl)
		for _, x := range cl {
			clients[x.ID] = x
		}
		var us []models.User
		database.DB.Unscoped().Select("id", "name").Where("id IN ?", userIDs).Find(&us)
		for _, u := range us {
			names[u.ID] = u.Name
		}
	}
	out := make([]editRequestView, 0, len(reqs))
	for _, r := range reqs {
		v := editRequestView{
			ID: r.ID, CreatedAt: r.CreatedAt, ClientID: r.ClientID,
			ClientNumber: clients[r.ClientID].ClientNumber, CompanyName: clients[r.ClientID].CompanyName,
			RequesterID: r.RequesterID, RequesterName: names[r.RequesterID],
			Reason: r.Reason, Status: r.Status, DecidedByID: r.DecidedByID, DecidedAt: r.DecidedAt,
			DecisionNote: r.DecisionNote, AccessMinutes: r.AccessMinutes, ExpiresAt: r.ExpiresAt,
		}
		if r.DecidedByID != nil {
			v.DecidedByName = names[*r.DecidedByID]
		}
		out = append(out, v)
	}
	return out
}

// clientEditApprovers: active super admins and active users whose role has
// manage_clients.
func clientEditApprovers() []uint {
	var ids []uint
	database.DB.Model(&models.User{}).
		Where("status = ? AND (role = ? OR role IN (SELECT role_key FROM role_permissions WHERE permission_key = ? AND granted = ? AND deleted_at IS NULL))",
			"active", "super_admin", "manage_clients", true).
		Pluck("id", &ids)
	return ids
}

// RequestClientEdit — POST /api/clients/:id/edit-requests
func RequestClientEdit(c *gin.Context) {
	v := viewerFrom(c)
	var input struct {
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	reason := strings.TrimSpace(input.Reason)
	if reason == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Please say what you need to change and why"})
		return
	}
	if utf8.RuneCountInString(reason) > 1000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "The reason is too long (max 1000 characters)"})
		return
	}

	var client models.Client
	if err := database.DB.First(&client, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Client not found"})
		return
	}
	if !middleware.HasPermission(v.Role, editAdminClientsPerm) || !createdByAdmin(client.CreatedByID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only request edit access to clients an Admin added"})
		return
	}
	if client.Status == "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This client is archived"})
		return
	}
	st := clientEditStateFor(v, &client, time.Now())
	if st.Allowed {
		c.JSON(http.StatusConflict, gin.H{"error": "You can already edit this client"})
		return
	}
	if st.Pending {
		c.JSON(http.StatusConflict, gin.H{"error": "You already have an edit request waiting for this client"})
		return
	}

	req := models.ClientEditRequest{ClientID: client.ID, RequesterID: v.ID, Reason: reason, Status: editRequestPending}
	if err := database.DB.Create(&req).Error; err != nil {
		serverError(c, "Could not send the request. Please try again.", err)
		return
	}
	auditClient(c, "edit_requested", client.ID,
		fmt.Sprintf("Requested edit access to client %s (%s): %s", client.ClientNumber, client.CompanyName, reason))
	notify(v.ID, notice{
		Type:       "access",
		Title:      "Client edit request",
		Message:    fmt.Sprintf("%s asks to edit client %s (%s): %s", actorName(v.ID), client.CompanyName, client.ClientNumber, reason),
		EntityType: "client_edit_request",
		EntityID:   req.ID,
	}, clientEditApprovers()...)

	c.JSON(http.StatusCreated, gin.H{"message": "Edit request sent", "request": editRequestViews([]models.ClientEditRequest{req})[0]})
}

// GetClientEditRequests — GET /api/clients/edit-requests?status=pending|all
func GetClientEditRequests(c *gin.Context) {
	v := viewerFrom(c)
	q := database.DB.Model(&models.ClientEditRequest{})
	if !managesClients(v) {
		q = q.Where("requester_id = ?", v.ID)
	}
	switch status := c.DefaultQuery("status", "pending"); status {
	case "all":
	case editRequestPending, editRequestApproved, editRequestRejected:
		q = q.Where("status = ?", status)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid status"})
		return
	}
	var reqs []models.ClientEditRequest
	if err := q.Order("created_at DESC").Limit(200).Find(&reqs).Error; err != nil {
		serverError(c, "Could not load edit requests", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": editRequestViews(reqs)})
}

// decideEditRequest loads a pending request the caller may decide.
func decideEditRequest(c *gin.Context) (*models.ClientEditRequest, *models.Client, bool) {
	v := viewerFrom(c)
	if !managesClients(v) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only a Super Admin or Admin can decide edit requests"})
		return nil, nil, false
	}
	var req models.ClientEditRequest
	if err := database.DB.First(&req, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Request not found"})
		return nil, nil, false
	}
	if req.RequesterID == v.ID {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can't decide your own request"})
		return nil, nil, false
	}
	if req.Status != editRequestPending {
		c.JSON(http.StatusConflict, gin.H{"error": "This request has already been " + req.Status})
		return nil, nil, false
	}
	var client models.Client
	if err := database.DB.Unscoped().First(&client, req.ClientID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Client not found"})
		return nil, nil, false
	}
	return &req, &client, true
}

// ApproveClientEdit — POST /api/clients/edit-requests/:id/approve
func ApproveClientEdit(c *gin.Context) {
	var input struct {
		Minutes int    `json:"minutes"`
		Note    string `json:"note"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	if input.Minutes == 0 {
		input.Minutes = 30
	}
	label, ok := editRequestDurations[input.Minutes]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Choose 30 minutes, 2 hours or 24 hours"})
		return
	}
	note := strings.TrimSpace(input.Note)
	if utf8.RuneCountInString(note) > 1000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "The note is too long (max 1000 characters)"})
		return
	}
	req, client, ok := decideEditRequest(c)
	if !ok {
		return
	}
	if client.Status == "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This client is archived, so it can't be edited"})
		return
	}

	uid := callerID(c)
	now := time.Now()
	expires := now.Add(time.Duration(input.Minutes) * time.Minute)
	// Only a still-pending request is updated, so two admins deciding at
	// once can't both win.
	res := database.DB.Model(&models.ClientEditRequest{}).
		Where("id = ? AND status = ?", req.ID, editRequestPending).
		Updates(map[string]interface{}{
			"status": editRequestApproved, "decided_by_id": uid, "decided_at": now,
			"decision_note": note, "access_minutes": input.Minutes, "expires_at": expires,
		})
	if res.Error != nil {
		serverError(c, "Could not approve the request", res.Error)
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Someone else has already decided this request"})
		return
	}

	auditClient(c, "edit_access_granted", client.ID,
		fmt.Sprintf("Approved edit access to client %s (%s) for %s, %s", client.ClientNumber, client.CompanyName, actorName(req.RequesterID), label))
	msg := fmt.Sprintf("You can edit client %s (%s) for the next %s.", client.CompanyName, client.ClientNumber, label)
	if note != "" {
		msg += " Note: " + note
	}
	notify(uid, notice{Type: "access", Title: "Edit request approved", Message: msg, EntityType: "client", EntityID: client.ID}, req.RequesterID)

	database.DB.First(req, req.ID)
	c.JSON(http.StatusOK, gin.H{"message": "Approved", "request": editRequestViews([]models.ClientEditRequest{*req})[0]})
}

// RejectClientEdit — POST /api/clients/edit-requests/:id/reject
func RejectClientEdit(c *gin.Context) {
	var input struct {
		Note string `json:"note"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	note := strings.TrimSpace(input.Note)
	if utf8.RuneCountInString(note) > 1000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "The note is too long (max 1000 characters)"})
		return
	}
	req, client, ok := decideEditRequest(c)
	if !ok {
		return
	}
	uid := callerID(c)
	now := time.Now()
	res := database.DB.Model(&models.ClientEditRequest{}).
		Where("id = ? AND status = ?", req.ID, editRequestPending).
		Updates(map[string]interface{}{"status": editRequestRejected, "decided_by_id": uid, "decided_at": now, "decision_note": note})
	if res.Error != nil {
		serverError(c, "Could not reject the request", res.Error)
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Someone else has already decided this request"})
		return
	}

	auditClient(c, "edit_access_rejected", client.ID,
		fmt.Sprintf("Rejected edit access to client %s (%s) for %s", client.ClientNumber, client.CompanyName, actorName(req.RequesterID)))
	msg := fmt.Sprintf("Your request to edit client %s (%s) was not approved.", client.CompanyName, client.ClientNumber)
	if note != "" {
		msg += " Note: " + note
	}
	notify(uid, notice{Type: "access", Title: "Edit request not approved", Message: msg, EntityType: "client", EntityID: client.ID}, req.RequesterID)

	database.DB.First(req, req.ID)
	c.JSON(http.StatusOK, gin.H{"message": "Rejected", "request": editRequestViews([]models.ClientEditRequest{*req})[0]})
}
