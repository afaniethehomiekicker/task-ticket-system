package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"unicode/utf8"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Spreadsheet import of clients and vendors.
//
//	POST /api/clients/import   (manage_clients)
//	POST /api/vendors/import   (manage_vendors)
//
// The browser reads the spreadsheet and sends the rows as JSON. The server is
// the only judge of what is valid:
//
//   - dry_run: true   checks every row (required values, formats, custom
//     fields, names that already exist or repeat in the file) and saves
//     nothing. The preview shows this answer.
//   - dry_run: false  checks the rows again against the database as it is
//     now and saves every valid row in ONE transaction: all of them are
//     saved, or — if anything goes wrong — none. Rows with problems are
//     skipped and reported; they never block the valid ones.
//
// A commit carries an idempotency_key. If the answer is lost (connection
// dropped, tab reloaded) and the browser sends the same request again, the
// stored answer is returned instead of importing the rows twice.
//
// Commits of the same kind run one at a time (a transaction-level advisory
// lock), so two people importing at once can't both create the same name.
// Every created record gets its own audit entry, written in the same
// transaction, plus one entry for the import as a whole.

const (
	maxImportRows   = 10000
	maxImportBytes  = 32 << 20 // 32 MB of JSON is far above 10,000 rows
	importBatchSize = 500

	// Arbitrary constants naming the advisory locks.
	importLockClients int64 = 7421_0001
	importLockVendors int64 = 7421_0002
)

var idempotencyKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

// Row statuses. A dry run answers ready/duplicate/error; a commit answers
// created/duplicate/error.
const (
	importReady     = "ready"
	importCreated   = "created"
	importDuplicate = "duplicate"
	importError     = "error"
)

type importRowResult struct {
	Row     int    `json:"row"`
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
	Number  string `json:"number,omitempty"`
}

type importSummary struct {
	Total     int `json:"total"`
	Ready     int `json:"ready"`
	Created   int `json:"created"`
	Duplicate int `json:"duplicate"`
	Error     int `json:"error"`
}

type importResponse struct {
	DryRun   bool              `json:"dry_run"`
	Replayed bool              `json:"replayed,omitempty"`
	BatchID  uint              `json:"batch_id,omitempty"`
	Summary  importSummary     `json:"summary"`
	Results  []importRowResult `json:"results"`
}

type importMeta struct {
	DryRun          bool   `json:"dry_run"`
	IdempotencyKey  string `json:"idempotency_key"`
	FileName        string `json:"file_name"`
	AllowDuplicates bool   `json:"allow_duplicates"`
}

func summarize(results []importRowResult, dryRun bool) importResponse {
	resp := importResponse{DryRun: dryRun, Results: results}
	resp.Summary.Total = len(results)
	for _, r := range results {
		switch r.Status {
		case importReady:
			resp.Summary.Ready++
		case importCreated:
			resp.Summary.Created++
		case importDuplicate:
			resp.Summary.Duplicate++
		case importError:
			resp.Summary.Error++
		}
	}
	return resp
}

// importText cleans one cell: invalid UTF-8 and NUL bytes (which Postgres
// rejects, failing the whole transaction) are removed, then spaces trimmed.
func importText(s string) string {
	s = strings.ToValidUTF8(s, "")
	s = strings.ReplaceAll(s, "\x00", "")
	return strings.TrimSpace(s)
}

// importNameKey is how names are compared for duplicates: case and runs of
// spaces ignored ("ACME  Ltd" matches "Acme Ltd").
func importNameKey(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

// fieldCheck holds one text field and its limit for checkLengths.
type fieldCheck struct {
	value *string
	label string
	max   int
}

// checkLengths cleans each field in place and returns one message per field
// that is too long.
func checkLengths(fields []fieldCheck) []string {
	var problems []string
	for _, f := range fields {
		*f.value = importText(*f.value)
		if utf8.RuneCountInString(*f.value) > f.max {
			problems = append(problems, fmt.Sprintf("%s is too long (max %d characters)", f.label, f.max))
		}
	}
	return problems
}

// importEmailOK accepts a plain address (no display name).
func importEmailOK(s string) bool {
	if s == "" {
		return true
	}
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s
}

// bindImport reads the request body with a size limit. It has written the
// error response when it returns false.
func bindImport(c *gin.Context, dst interface{}) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxImportBytes)
	if err := c.ShouldBindJSON(dst); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "The import is too large. Split the file and import each part separately."})
			return false
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "The import request could not be read."})
		return false
	}
	return true
}

// checkImportMeta validates the parts of the request every import shares.
func checkImportMeta(c *gin.Context, meta *importMeta, rows int) bool {
	if rows == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "There are no rows to import."})
		return false
	}
	if rows > maxImportRows {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("At most %d rows can be imported at once. Split the file and import each part separately.", maxImportRows)})
		return false
	}
	if !meta.DryRun && !idempotencyKeyPattern.MatchString(meta.IdempotencyKey) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing or invalid idempotency_key."})
		return false
	}
	meta.FileName = importText(meta.FileName)
	if utf8.RuneCountInString(meta.FileName) > 255 {
		meta.FileName = string([]rune(meta.FileName)[:255])
	}
	return true
}

// rowNumber is the row as the person sees it in their spreadsheet; the
// browser sends it. Falls back to the position in the request.
func rowNumber(given, index int) int {
	if given > 0 {
		return given
	}
	return index + 2 // row 1 is the heading
}

// existingName is a record already in the database with a given name.
type existingName struct {
	Number   string
	Archived bool
}

// duplicateMessage explains why a row was skipped as a duplicate.
func duplicateMessage(entity string, e existingName) string {
	if e.Archived {
		return fmt.Sprintf("Matches archived %s %s. Restore it from the Archive instead of importing it again.", entity, e.Number)
	}
	return fmt.Sprintf("Already exists (%s)", e.Number)
}

// runImportCommit is the transaction shared by every import. plan checks the
// rows against the database inside the transaction (after the lock) and
// returns their results; insert saves the ready rows of that plan, sets each
// one's Number, and returns the audit entries for the records it created.
func runImportCommit(
	c *gin.Context,
	entity string,
	lockKey int64,
	meta importMeta,
	totalRows int,
	plan func(tx *gorm.DB) ([]importRowResult, error),
	insert func(tx *gorm.DB, batchID uint, results []importRowResult) ([]models.AuditLog, error),
) {
	uid := callerID(c)
	var resp importResponse
	replayed := false

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", lockKey).Error; err != nil {
			return err
		}

		// Same key as an import that already went through: answer as before.
		var prior models.ImportBatch
		err := tx.Where("created_by_id = ? AND idempotency_key = ?", uid, meta.IdempotencyKey).Take(&prior).Error
		if err == nil {
			if prior.EntityType != entity {
				return fmt.Errorf("idempotency key reused for a %s import", prior.EntityType)
			}
			if jerr := json.Unmarshal([]byte(prior.Result), &resp); jerr != nil {
				return jerr
			}
			resp.Replayed = true
			replayed = true
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		results, err := plan(tx)
		if err != nil {
			return err
		}

		batch := models.ImportBatch{
			EntityType:     entity,
			CreatedByID:    uid,
			IdempotencyKey: meta.IdempotencyKey,
			FileName:       meta.FileName,
			TotalRows:      totalRows,
		}
		if err := tx.Create(&batch).Error; err != nil {
			return err
		}

		audits, err := insert(tx, batch.ID, results)
		if err != nil {
			return err
		}

		resp = summarize(results, false)
		resp.BatchID = batch.ID
		skipped := resp.Summary.Duplicate + resp.Summary.Error

		source := "a spreadsheet"
		if meta.FileName != "" {
			source = meta.FileName
		}
		audits = append(audits, models.AuditLog{
			UserID:       utils.Actor(uid),
			Action:       "imported",
			ResourceType: "import_batch",
			ResourceID:   batch.ID,
			OldValues:    "{}",
			NewValues:    "{}",
			Details: fmt.Sprintf("Imported %s from %s (%d of %d rows skipped)",
				plural(resp.Summary.Created, entity), source, skipped, totalRows),
			IPAddress: c.ClientIP(),
			UserAgent: c.Request.UserAgent(),
		})
		if err := tx.CreateInBatches(&audits, importBatchSize).Error; err != nil {
			return err
		}

		stored, err := json.Marshal(resp)
		if err != nil {
			return err
		}
		return tx.Model(&batch).Updates(map[string]interface{}{
			"created_count": resp.Summary.Created,
			"skipped_count": skipped,
			"result":        string(stored),
		}).Error
	})

	if err != nil {
		if strings.Contains(err.Error(), "SQLSTATE 23505") {
			// A unique index caught a name created by someone else while
			// this import ran. Nothing was saved.
			c.JSON(http.StatusConflict, gin.H{"error": "Another change to the list happened while importing, so nothing was saved. Check the file again and import it."})
			return
		}
		log.Printf("import %s: %v", entity, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "The import failed and nothing was saved. Please try again."})
		return
	}
	if replayed {
		log.Printf("import %s: replayed batch for idempotency key from user %d", entity, uid)
	}
	c.JSON(http.StatusOK, resp)
}

// plural renders "1 client" / "12 clients".
func plural(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}
	return fmt.Sprintf("%d %ss", n, noun)
}

// ---- Clients ----------------------------------------------------------------

type clientImportRow struct {
	Row           int                    `json:"row"`
	CompanyName   string                 `json:"company_name"`
	ClientName    string                 `json:"client_name"`
	CNIC          string                 `json:"cnic"`
	Mobile        string                 `json:"mobile"`
	ContactPerson string                 `json:"contact_person"`
	Email         string                 `json:"email"`
	Phone         string                 `json:"phone"`
	Website       string                 `json:"website"`
	Industry      string                 `json:"industry"`
	Address       string                 `json:"address"`
	City          string                 `json:"city"`
	Country       string                 `json:"country"`
	Notes         string                 `json:"notes"`
	Status        string                 `json:"status"`
	CustomFields  map[string]interface{} `json:"custom_fields"`
}

type clientImportRequest struct {
	importMeta
	Rows []clientImportRow `json:"rows"`
}

// planClientImport checks every row and builds the clients to create (one per
// ready result, in order). It reads the database through db, so inside the
// commit it sees the data as it is under the lock.
func planClientImport(db *gorm.DB, rows []clientImportRow, allowDuplicates bool) ([]importRowResult, []models.Client, error) {
	var defs []models.ClientField
	if err := db.Find(&defs).Error; err != nil {
		return nil, nil, err
	}

	var existingRows []struct {
		ClientNumber string
		CompanyName  string
		Status       string
	}
	if err := db.Model(&models.Client{}).Select("client_number", "company_name", "status").Find(&existingRows).Error; err != nil {
		return nil, nil, err
	}
	existing := make(map[string]existingName, len(existingRows))
	for _, e := range existingRows {
		k := importNameKey(e.CompanyName)
		if prev, ok := existing[k]; ok && !prev.Archived {
			continue // an active match is the more useful one to report
		}
		existing[k] = existingName{Number: e.ClientNumber, Archived: e.Status == "archived"}
	}

	results := make([]importRowResult, len(rows))
	var clients []models.Client
	firstRow := map[string]int{}

	for i := range rows {
		r := rows[i]
		res := importRowResult{Row: rowNumber(r.Row, i)}

		problems := checkLengths([]fieldCheck{
			{&r.CompanyName, "Company name", 255}, {&r.ClientName, "Client name", 255},
			{&r.CNIC, "CNIC", 20}, {&r.Mobile, "Mobile", 50}, {&r.ContactPerson, "Contact person", 255},
			{&r.Email, "Email", 255}, {&r.Phone, "Phone", 50}, {&r.Website, "Website", 500},
			{&r.Industry, "Industry", 255}, {&r.Address, "Address", 1000}, {&r.City, "City", 255},
			{&r.Country, "Country", 255}, {&r.Notes, "Notes", 4000}, {&r.Status, "Status", 20},
		})
		if r.CompanyName == "" {
			problems = append([]string{"Company name is missing"}, problems...)
		}
		if !validCNIC(r.CNIC) {
			problems = append(problems, "CNIC must be 13 digits (e.g. 12345-1234567-1)")
		}
		if !importEmailOK(r.Email) {
			problems = append(problems, "Email address is not valid")
		}
		status := strings.ToLower(r.Status)
		if status == "" {
			status = "active"
		}
		if status != "active" && status != "inactive" {
			problems = append(problems, "Status must be active or inactive")
		}
		custom := map[string]interface{}{}
		for k, v := range r.CustomFields {
			if s, ok := v.(string); ok {
				v = importText(s)
			}
			custom[k] = v
		}
		customOut, msg := validateClientCustomFieldsWith(defs, custom, nil)
		if msg != "" {
			problems = append(problems, msg)
		}

		if len(problems) > 0 {
			res.Status = importError
			res.Message = strings.Join(problems, "; ")
			results[i] = res
			continue
		}

		key := importNameKey(r.CompanyName)
		if e, ok := existing[key]; ok && (e.Archived || !allowDuplicates) {
			res.Status = importDuplicate
			res.Message = duplicateMessage("client", e)
			results[i] = res
			continue
		}
		if prev, ok := firstRow[key]; ok && !allowDuplicates {
			res.Status = importDuplicate
			res.Message = fmt.Sprintf("Same company name as row %d in this file", prev)
			results[i] = res
			continue
		}
		if _, ok := firstRow[key]; !ok {
			firstRow[key] = res.Row
		}

		res.Status = importReady
		results[i] = res
		clients = append(clients, models.Client{
			CompanyName:   r.CompanyName,
			ClientName:    r.ClientName,
			CNIC:          r.CNIC,
			Mobile:        r.Mobile,
			CustomFields:  customOut,
			ContactPerson: r.ContactPerson,
			Email:         r.Email,
			Phone:         r.Phone,
			Website:       r.Website,
			Industry:      r.Industry,
			Address:       r.Address,
			City:          r.City,
			Country:       r.Country,
			Notes:         r.Notes,
			Status:        status,
		})
	}
	return results, clients, nil
}

// ImportClients — POST /api/clients/import.
func ImportClients(c *gin.Context) {
	var req clientImportRequest
	if !bindImport(c, &req) || !checkImportMeta(c, &req.importMeta, len(req.Rows)) {
		return
	}

	if req.DryRun {
		results, _, err := planClientImport(database.DB, req.Rows, req.AllowDuplicates)
		if err != nil {
			serverError(c, "Could not check the import. Please try again.", err)
			return
		}
		c.JSON(http.StatusOK, summarize(results, true))
		return
	}

	var clients []models.Client
	runImportCommit(c, "client", importLockClients, req.importMeta, len(req.Rows),
		func(tx *gorm.DB) ([]importRowResult, error) {
			results, planned, err := planClientImport(tx, req.Rows, req.AllowDuplicates)
			clients = planned
			return results, err
		},
		func(tx *gorm.DB, batchID uint, results []importRowResult) ([]models.AuditLog, error) {
			if len(clients) == 0 {
				return nil, nil
			}
			first, err := models.NextIDRange(tx, "CL", len(clients))
			if err != nil {
				return nil, err
			}
			uid := callerID(c)
			for i := range clients {
				clients[i].ClientNumber = models.FormatID("CL", first+int64(i))
				clients[i].ImportBatchID = &batchID
				if uid != 0 {
					creator := uid
					clients[i].CreatedByID = &creator
				}
			}
			if err := tx.CreateInBatches(&clients, importBatchSize).Error; err != nil {
				return nil, err
			}

			source := req.FileName
			if source == "" {
				source = "a spreadsheet"
			}
			audits := make([]models.AuditLog, 0, len(clients)+1)
			n := 0
			for i := range results {
				if results[i].Status != importReady {
					continue
				}
				cl := clients[n]
				n++
				results[i].Status = importCreated
				results[i].Number = cl.ClientNumber
				results[i].Message = ""
				audits = append(audits, models.AuditLog{
					UserID:       utils.Actor(uid),
					Action:       "created",
					ResourceType: "client",
					ResourceID:   cl.ID,
					OldValues:    "{}",
					NewValues:    "{}",
					Details: fmt.Sprintf("Created client %s: %s (import #%d from %s, row %d)",
						cl.ClientNumber, cl.CompanyName, batchID, source, results[i].Row),
					IPAddress: c.ClientIP(),
					UserAgent: c.Request.UserAgent(),
				})
			}
			return audits, nil
		})
}

// ---- Vendors ----------------------------------------------------------------

type vendorImportRow struct {
	Row           int    `json:"row"`
	Name          string `json:"name"`
	ContactPerson string `json:"contact_person"`
	Phone         string `json:"phone"`
	Email         string `json:"email"`
	Cities        string `json:"cities"`
	Services      string `json:"services"`
	Notes         string `json:"notes"`
}

type vendorImportRequest struct {
	importMeta
	Rows []vendorImportRow `json:"rows"`
}

// planVendorImport checks every row and builds the vendors to create. Vendor
// names are unique (a database index), so duplicates are always skipped.
func planVendorImport(db *gorm.DB, rows []vendorImportRow) ([]importRowResult, []models.Vendor, error) {
	var existingRows []struct {
		VendorNumber string
		Name         string
		Status       string
	}
	if err := db.Model(&models.Vendor{}).Select("vendor_number", "name", "status").Find(&existingRows).Error; err != nil {
		return nil, nil, err
	}
	existing := make(map[string]existingName, len(existingRows))
	for _, e := range existingRows {
		existing[importNameKey(e.Name)] = existingName{Number: e.VendorNumber, Archived: e.Status == "archived"}
	}

	results := make([]importRowResult, len(rows))
	var vendors []models.Vendor
	firstRow := map[string]int{}

	for i := range rows {
		r := rows[i]
		res := importRowResult{Row: rowNumber(r.Row, i)}

		// Same limits as vendorInput.clean() (manual add/edit).
		problems := checkLengths([]fieldCheck{
			{&r.Name, "Name", 150}, {&r.ContactPerson, "Contact person", 150},
			{&r.Phone, "Phone", 50}, {&r.Email, "Email", 150},
			{&r.Cities, "Cities", 500}, {&r.Services, "Services", 500}, {&r.Notes, "Notes", 4000},
		})
		if r.Name == "" {
			problems = append([]string{"Vendor name is missing"}, problems...)
		}
		if !importEmailOK(r.Email) {
			problems = append(problems, "Email address is not valid")
		}
		if len(problems) > 0 {
			res.Status = importError
			res.Message = strings.Join(problems, "; ")
			results[i] = res
			continue
		}

		key := importNameKey(r.Name)
		if e, ok := existing[key]; ok {
			res.Status = importDuplicate
			res.Message = duplicateMessage("vendor", e)
			results[i] = res
			continue
		}
		if prev, ok := firstRow[key]; ok {
			res.Status = importDuplicate
			res.Message = fmt.Sprintf("Same vendor name as row %d in this file", prev)
			results[i] = res
			continue
		}
		firstRow[key] = res.Row

		res.Status = importReady
		results[i] = res
		vendors = append(vendors, models.Vendor{
			Name:          r.Name,
			ContactPerson: r.ContactPerson,
			Phone:         r.Phone,
			Email:         r.Email,
			Cities:        r.Cities,
			Services:      r.Services,
			Notes:         r.Notes,
		})
	}
	return results, vendors, nil
}

// ImportVendors — POST /api/vendors/import.
func ImportVendors(c *gin.Context) {
	var req vendorImportRequest
	if !bindImport(c, &req) || !checkImportMeta(c, &req.importMeta, len(req.Rows)) {
		return
	}

	if req.DryRun {
		results, _, err := planVendorImport(database.DB, req.Rows)
		if err != nil {
			serverError(c, "Could not check the import. Please try again.", err)
			return
		}
		c.JSON(http.StatusOK, summarize(results, true))
		return
	}

	var vendors []models.Vendor
	runImportCommit(c, "vendor", importLockVendors, req.importMeta, len(req.Rows),
		func(tx *gorm.DB) ([]importRowResult, error) {
			results, planned, err := planVendorImport(tx, req.Rows)
			vendors = planned
			return results, err
		},
		func(tx *gorm.DB, batchID uint, results []importRowResult) ([]models.AuditLog, error) {
			if len(vendors) == 0 {
				return nil, nil
			}
			first, err := models.NextIDRange(tx, "VEN", len(vendors))
			if err != nil {
				return nil, err
			}
			uid := callerID(c)
			for i := range vendors {
				// Set here, so Vendor.BeforeCreate doesn't take a number per row.
				vendors[i].VendorNumber = models.FormatID("VEN", first+int64(i))
				vendors[i].ImportBatchID = &batchID
				creator := uid
				vendors[i].CreatedByID = &creator
			}
			if err := tx.CreateInBatches(&vendors, importBatchSize).Error; err != nil {
				return nil, err
			}

			source := req.FileName
			if source == "" {
				source = "a spreadsheet"
			}
			audits := make([]models.AuditLog, 0, len(vendors)+1)
			n := 0
			for i := range results {
				if results[i].Status != importReady {
					continue
				}
				v := vendors[n]
				n++
				results[i].Status = importCreated
				results[i].Number = v.VendorNumber
				results[i].Message = ""
				audits = append(audits, models.AuditLog{
					UserID:       utils.Actor(uid),
					Action:       "created",
					ResourceType: "vendor",
					ResourceID:   v.ID,
					OldValues:    "{}",
					NewValues:    "{}",
					Details: fmt.Sprintf("Created vendor %s (%s) (import #%d from %s, row %d)",
						v.Name, v.VendorNumber, batchID, source, results[i].Row),
					IPAddress: c.ClientIP(),
					UserAgent: c.Request.UserAgent(),
				})
			}
			return audits, nil
		})
}
