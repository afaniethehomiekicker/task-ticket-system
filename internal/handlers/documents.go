package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Documents & evidence — spec slide 27 ("Upload PDFs, images, screenshots,
// network diagrams, and supporting documents — tracked with who uploaded it,
// when, on which record, with version history") and slide 25 (evidence per
// feasibility vendor: "ping results, traceroutes, screenshots, network
// diagrams, formal quotations").
//
//	GET    /api/documents?record_type=&record_id=   list (current versions + history)
//	POST   /api/documents                          upload (multipart: file, record_type,
//	                                               record_id, note, replaces_id)
//	GET    /api/documents/:id/download             the file, access-checked
//	DELETE /api/documents/:id                      archive (the file is kept)
//
// Files are stored under DOCUMENTS_DIR (default ./storage/documents) — NOT in
// the public /uploads folder, which anyone with a link can open. Every
// request checks that the caller can see the record the document belongs to.

const maxDocumentBytes = 25 << 20 // 25 MB

var allowedDocExt = map[string]bool{
	".pdf": true, ".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
	".txt": true, ".log": true, ".csv": true, ".xlsx": true, ".xls": true, ".docx": true, ".doc": true,
	".pptx": true, ".ppt": true, ".vsdx": true, ".drawio": true, ".zip": true, ".pcap": true, ".pcapng": true,
	".msg": true, ".eml": true, ".json": true, ".xml": true,
}

func documentsDir() string {
	if d := strings.TrimSpace(os.Getenv("DOCUMENTS_DIR")); d != "" {
		return d
	}
	return filepath.Join(".", "storage", "documents")
}

// documentRecord checks the caller can see the record and returns a label for
// audit text plus the audit resource (vendor evidence is logged on its
// feasibility). It has written the error response when ok is false.
func documentRecord(c *gin.Context, recordType string, recordID uint) (label, auditType string, auditID uint, ok bool) {
	return documentRecordAccess(c, recordType, recordID, false)
}

// documentRecordForRead is documentRecord for listing and downloading: a
// department viewer of a non-private task or ticket may read its files, but
// uploading and removing still need full access (documentRecord).
func documentRecordForRead(c *gin.Context, recordType string, recordID uint) (label, auditType string, auditID uint, ok bool) {
	return documentRecordAccess(c, recordType, recordID, true)
}

func documentRecordAccess(c *gin.Context, recordType string, recordID uint, readOnly bool) (label, auditType string, auditID uint, ok bool) {
	deny := func() (string, string, uint, bool) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return "", "", 0, false
	}
	missing := func() (string, string, uint, bool) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Record not found"})
		return "", "", 0, false
	}
	switch recordType {
	case "ticket":
		var t models.Ticket
		if database.DB.First(&t, recordID).Error != nil {
			return missing()
		}
		if !userCanAccessTicket(c, &t) && !(readOnly && userCanViewTicket(c, &t)) {
			return deny()
		}
		return t.TicketNumber, "ticket", t.ID, true
	case "task":
		var t models.Task
		if database.DB.First(&t, recordID).Error != nil {
			return missing()
		}
		if !userCanAccessTask(c, &t) && !(readOnly && userCanViewTask(c, &t)) {
			return deny()
		}
		return t.TaskNumber, "task", t.ID, true
	case "project":
		var p models.Project
		if database.DB.First(&p, recordID).Error != nil {
			return missing()
		}
		if !userCanAccessProject(c, &p) {
			return deny()
		}
		return p.Code, "project", p.ID, true
	case "feasibility":
		var f models.Feasibility
		if database.DB.First(&f, recordID).Error != nil {
			return missing()
		}
		if !userCanAccessFeasibility(c, &f) {
			return deny()
		}
		return f.FeasibilityNumber, "feasibility", f.ID, true
	case "vendor":
		var v models.FeasibilityVendor
		if database.DB.First(&v, recordID).Error != nil {
			return missing()
		}
		var f models.Feasibility
		if database.DB.First(&f, v.FeasibilityID).Error != nil {
			return missing()
		}
		if !userCanAccessFeasibility(c, &f) {
			return deny()
		}
		return f.FeasibilityNumber + " / " + v.VendorName, "feasibility", f.ID, true
	}
	c.JSON(http.StatusBadRequest, gin.H{"error": "record_type must be ticket, task, project, feasibility or vendor"})
	return "", "", 0, false
}

func parseRecordRef(c *gin.Context, typ, idStr string) (string, uint, bool) {
	id, err := strconv.ParseUint(strings.TrimSpace(idStr), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "record_id is required"})
		return "", 0, false
	}
	return strings.TrimSpace(typ), uint(id), true
}

func userBasicsWithEmail(db *gorm.DB) *gorm.DB { return db.Select("id", "name", "role") }

func ListDocuments(c *gin.Context) {
	rt, rid, ok := parseRecordRef(c, c.Query("record_type"), c.Query("record_id"))
	if !ok {
		return
	}
	if _, _, _, ok := documentRecordForRead(c, rt, rid); !ok {
		return
	}
	var docs []models.Document
	database.DB.Preload("UploadedBy", userBasicsWithEmail).
		Where("record_type = ? AND record_id = ? AND archived_at IS NULL", rt, rid).
		Order("group_id ASC, version DESC").Find(&docs)
	c.JSON(http.StatusOK, gin.H{"documents": docs})
}

func UploadDocument(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxDocumentBytes+(1<<20))
	rt, rid, ok := parseRecordRef(c, c.PostForm("record_type"), c.PostForm("record_id"))
	if !ok {
		return
	}
	label, auditType, auditID, ok := documentRecord(c, rt, rid)
	if !ok {
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Choose a file to upload (max 25 MB)"})
		return
	}
	defer file.Close()
	if header.Size > maxDocumentBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "File is larger than 25 MB"})
		return
	}
	name := filepath.Base(strings.ReplaceAll(header.Filename, "\\", "/"))
	ext := strings.ToLower(filepath.Ext(name))
	if !allowedDocExt[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "That file type isn't allowed (" + ext + ")"})
		return
	}
	if len(name) > 200 {
		name = name[:200]
	}

	// New version of an existing document?
	group, version := uint(0), 1
	if rep := strings.TrimSpace(c.PostForm("replaces_id")); rep != "" {
		// Must be parsed to a number BEFORE it reaches GORM. First(&row, s)
		// with a non-numeric string is not a primary-key lookup: GORM pastes
		// the string into the WHERE clause as raw SQL. This form field was
		// passed straight through, and NumericIDParams only guards PATH
		// parameters, so any signed-in user could run their own SQL here.
		repID, err := strconv.ParseUint(rep, 10, 64)
		if err != nil || repID == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "replaces_id must be a document id"})
			return
		}
		var prev models.Document
		if err := database.DB.Where("id = ?", repID).First(&prev).Error; err != nil || prev.RecordType != rt || prev.RecordID != rid || prev.ArchivedAt != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "The document to replace wasn't found on this record"})
			return
		}
		group = prev.GroupID
		var maxV int
		database.DB.Model(&models.Document{}).Where("group_id = ?", group).Select("COALESCE(MAX(version), 0)").Scan(&maxV)
		version = maxV + 1
	}

	dir := documentsDir()
	if err := os.MkdirAll(dir, 0o750); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Storage unavailable"})
		return
	}
	rnd := make([]byte, 16)
	if _, err := rand.Read(rnd); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store file"})
		return
	}
	stored := hex.EncodeToString(rnd) + ext
	dst := filepath.Join(dir, stored)
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o640)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store file"})
		return
	}
	written, err := io.Copy(out, io.LimitReader(file, maxDocumentBytes+1))
	out.Close()
	if err != nil || written > maxDocumentBytes {
		os.Remove(dst)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Upload failed or file too large"})
		return
	}
	mime := header.Header.Get("Content-Type")
	if mime == "" {
		mime = "application/octet-stream"
	}

	note := strings.TrimSpace(c.PostForm("note"))
	if len(note) > 500 {
		note = note[:500]
	}
	doc := models.Document{
		RecordType: rt, RecordID: rid, GroupID: group, Version: version,
		Name: name, MimeType: mime, Size: written, StoragePath: stored, Note: note,
		UploadedByID: viewerFrom(c).ID,
	}
	if err := database.DB.Create(&doc).Error; err != nil {
		os.Remove(dst)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save document"})
		return
	}
	if doc.GroupID == 0 {
		doc.GroupID = doc.ID
		database.DB.Model(&doc).Update("group_id", doc.ID)
	}
	what := "Uploaded"
	if version > 1 {
		what = fmt.Sprintf("Uploaded version %d of", version)
	}
	utils.LogAudit(viewerFrom(c).ID, "document_uploaded", auditType, auditID,
		fmt.Sprintf("%s %q on %s (%s)", what, name, label, humanSize(written)), c.ClientIP(), c.Request.UserAgent())

	database.DB.Preload("UploadedBy", userBasicsWithEmail).First(&doc, doc.ID)
	c.JSON(http.StatusCreated, gin.H{"document": doc})
}

func DownloadDocument(c *gin.Context) {
	var doc models.Document
	if err := database.DB.First(&doc, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Document not found"})
		return
	}
	if _, _, _, ok := documentRecordForRead(c, doc.RecordType, doc.RecordID); !ok {
		return
	}
	path := filepath.Join(documentsDir(), filepath.Base(doc.StoragePath))
	if _, err := os.Stat(path); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "The file is missing from storage"})
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.FileAttachment(path, doc.Name)
}

// ArchiveDocument hides a document from the record (nothing is deleted —
// spec slides 4/29). The uploader, or anyone who can edit the record's kind
// of work (admins), may do it.
func ArchiveDocument(c *gin.Context) {
	var doc models.Document
	if err := database.DB.First(&doc, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Document not found"})
		return
	}
	label, auditType, auditID, ok := documentRecord(c, doc.RecordType, doc.RecordID)
	if !ok {
		return
	}
	v := viewerFrom(c)
	if doc.UploadedByID != v.ID && v.Role != "admin" && v.Role != "super_admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the uploader or an admin can remove a document"})
		return
	}
	now := time.Now()
	database.DB.Model(&doc).Updates(map[string]interface{}{"archived_at": now, "archived_by_id": v.ID})
	utils.LogAudit(v.ID, "document_removed", auditType, auditID,
		fmt.Sprintf("Removed %q (v%d) from %s — kept in storage", doc.Name, doc.Version, label), c.ClientIP(), c.Request.UserAgent())
	c.JSON(http.StatusOK, gin.H{"message": "Document removed"})
}

func humanSize(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.0f KB", float64(n)/(1<<10))
	}
	return fmt.Sprintf("%d B", n)
}
