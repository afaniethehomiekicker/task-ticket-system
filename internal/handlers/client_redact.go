package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// RedactEmbeddedClients enforces the client rule (spec slide 16, see
// client_access.go) on every response, not just the /api/clients endpoints.
//
// Tickets, projects, feasibilities, reports, search results ... all embed
// their client ("client": {...}, "clients": [...]). Those used to carry the
// FULL client record — contact person, phone, email, address, notes — to
// anyone who could see the ticket or project, even though that person is only
// meant to see the client's reference fields (ID, company name, city,
// status). Rather than patch dozens of handlers one by one (and miss the next
// one added), this filter rewrites any embedded client the caller isn't
// allowed to see in full down to those reference fields.
//
// It does nothing for people who see all clients in full (super admin,
// company-wide admins, "Manage Client & Company Profiles"), for the
// /api/clients endpoints (they apply the rule themselves), and for non-JSON
// responses such as file downloads.
func RedactEmbeddedClients() gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/clients") || seesAllClients(c) {
			c.Next()
			return
		}
		w := &bufferedJSONWriter{ResponseWriter: c.Writer, status: http.StatusOK}
		c.Writer = w
		c.Next()
		c.Writer = w.ResponseWriter

		if w.passthrough {
			return // already written straight through
		}
		body := w.buf.Bytes()
		if w.status >= 200 && w.status < 300 && len(body) > 0 {
			if out, ok := redactClientsInJSON(c, body); ok {
				body = out
			}
		}
		w.ResponseWriter.Header().Del("Content-Length")
		w.ResponseWriter.WriteHeader(w.status)
		w.ResponseWriter.Write(body)
	}
}

// bufferedJSONWriter holds back JSON bodies so they can be rewritten; any
// other content type is passed straight through untouched.
type bufferedJSONWriter struct {
	gin.ResponseWriter
	buf         bytes.Buffer
	status      int
	decided     bool
	passthrough bool
}

func (w *bufferedJSONWriter) WriteHeader(code int) {
	w.status = code
	if w.passthrough {
		w.ResponseWriter.WriteHeader(code)
	}
}

func (w *bufferedJSONWriter) WriteHeaderNow() {
	if w.passthrough {
		w.ResponseWriter.WriteHeaderNow()
	}
}

func (w *bufferedJSONWriter) decide() {
	if w.decided {
		return
	}
	w.decided = true
	if !strings.Contains(w.ResponseWriter.Header().Get("Content-Type"), "application/json") {
		w.passthrough = true
		w.ResponseWriter.WriteHeader(w.status)
	}
}

func (w *bufferedJSONWriter) Write(b []byte) (int, error) {
	w.decide()
	if w.passthrough {
		return w.ResponseWriter.Write(b)
	}
	return w.buf.Write(b)
}

func (w *bufferedJSONWriter) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}

func (w *bufferedJSONWriter) Status() int { return w.status }

func (w *bufferedJSONWriter) Written() bool { return w.decided }

// Fields a reference-only viewer may see (same as clientRef).
var clientRefKeys = map[string]bool{
	"ID": true, "CreatedAt": true, "UpdatedAt": true, "DeletedAt": true,
	"client_number": true, "company_name": true, "city": true, "status": true,
}

func looksLikeClient(m map[string]interface{}) bool {
	_, hasNumber := m["client_number"]
	_, hasName := m["company_name"]
	return hasNumber || hasName
}

func clientIDOf(m map[string]interface{}) (uint, bool) {
	n, ok := m["ID"].(json.Number)
	if !ok {
		return 0, false
	}
	id, err := strconv.ParseUint(n.String(), 10, 64)
	return uint(id), err == nil
}

// redactClientsInJSON rewrites the body; ok=false means "leave it as is".
func redactClientsInJSON(c *gin.Context, body []byte) ([]byte, bool) {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var doc interface{}
	if err := dec.Decode(&doc); err != nil {
		return nil, false
	}

	// Pass 1: find every embedded client.
	var found []map[string]interface{}
	var walk func(v interface{})
	walk = func(v interface{}) {
		switch t := v.(type) {
		case map[string]interface{}:
			for k, child := range t {
				if k == "client" || k == "clients" {
					switch cv := child.(type) {
					case map[string]interface{}:
						if looksLikeClient(cv) {
							found = append(found, cv)
						}
					case []interface{}:
						for _, item := range cv {
							if m, ok := item.(map[string]interface{}); ok && looksLikeClient(m) {
								found = append(found, m)
							}
						}
					}
				}
				walk(child)
			}
		case []interface{}:
			for _, child := range t {
				walk(child)
			}
		}
	}
	walk(doc)
	if len(found) == 0 {
		return nil, false
	}

	// Which of them may this caller see in full? One query.
	ids := make([]uint, 0, len(found))
	for _, m := range found {
		if id, ok := clientIDOf(m); ok {
			ids = append(ids, id)
		}
	}
	full := map[uint]bool{}
	if len(ids) > 0 {
		var fullIDs []uint
		clause, args := clientFullClause(viewerFrom(c))
		database.DB.Model(&models.Client{}).Where("clients.id IN ?", ids).Where(clause, args...).Pluck("clients.id", &fullIDs)
		for _, id := range fullIDs {
			full[id] = true
		}
	}

	// Pass 2: strip the rest down to reference fields, in place.
	changed := false
	for _, m := range found {
		if id, ok := clientIDOf(m); ok && full[id] {
			m["access_level"] = "full"
			continue
		}
		for k := range m {
			if !clientRefKeys[k] {
				delete(m, k)
			}
		}
		m["access_level"] = "reference"
		changed = true
	}
	if !changed {
		return nil, false
	}

	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	if err := enc.Encode(doc); err != nil {
		return nil, false
	}
	return bytes.TrimRight(out.Bytes(), "\n"), true
}
