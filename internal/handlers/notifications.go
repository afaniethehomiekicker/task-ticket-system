package handlers

import (
	"fmt"
	"log"
	"mime"
	"net/http"
	"net/smtp"
	"os"
	"strconv"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Notifications — spec slide 27: "Notification channels: In-App (primary
// method), Email (assignments, SLA breach, transfers), WhatsApp (integration
// option)."
//
//	GET  /api/notifications              the caller's latest 50 (+ unread count)
//	PATCH /api/notifications/:id/read
//	POST /api/notifications/read-all
//
// notify() is called wherever something happens to someone. It never
// notifies people about their own actions. Email goes out for the types in
// emailTypes when SMTP is configured (SMTP_HOST, SMTP_PORT, SMTP_USER,
// SMTP_PASSWORD, SMTP_FROM; APP_URL for links) — otherwise in-app only.

type notice struct {
	Type       string
	Title      string
	Message    string
	EntityType string
	EntityID   uint
}

// notify sends one notice to each recipient (duplicates and the actor are
// skipped). actorID 0 = the system.
func notify(actorID uint, n notice, recipients ...uint) {
	seen := map[uint]bool{}
	for _, r := range recipients {
		if r == 0 || r == actorID || seen[r] {
			continue
		}
		seen[r] = true
		row := models.Notification{
			UserID: r, Type: n.Type, Title: n.Title, Message: n.Message,
			EntityType: n.EntityType, EntityID: n.EntityID,
		}
		if actorID != 0 {
			a := actorID
			row.ActorID = &a
		}
		if err := database.DB.Create(&row).Error; err != nil {
			log.Printf("notify: saving notification for user %d failed: %v", r, err)
			continue
		}
		if emailTypes[n.Type] {
			go emailNotice(r, n)
		}
	}
}

func notifyPtr(actorID uint, n notice, recipient *uint) {
	if recipient != nil {
		notify(actorID, n, *recipient)
	}
}

// Recipient helpers.

func actorName(id uint) string {
	if id == 0 {
		return "The system"
	}
	return assigneeLabel(&id)
}

// departmentAdmins: active admins of a department.
func departmentAdmins(dept string) []uint {
	var ids []uint
	if strings.TrimSpace(dept) == "" {
		return ids
	}
	database.DB.Model(&models.User{}).
		Where("role = ? AND LOWER(TRIM(department)) = LOWER(?) AND status = ?", "admin", strings.TrimSpace(dept), "active").
		Pluck("id", &ids)
	return ids
}

func superAdmins() []uint {
	var ids []uint
	database.DB.Model(&models.User{}).Where("role = ? AND status = ?", "super_admin", "active").Pluck("id", &ids)
	return ids
}

// supervisorOfUser: the user's supervisor, if any.
func supervisorOfUser(userID *uint) []uint {
	if s := supervisorOf(userID); s != nil {
		return []uint{*s}
	}
	return nil
}

// ---- email ------------------------------------------------------------------

// Spec slide 27: email for "assignments, SLA breach, transfers".
var emailTypes = map[string]bool{
	"assignment": true, "transfer": true, "routed": true, "returned": true,
	"reopened": true, "sla_breach": true, "escalation": true,
}

func emailNotice(userID uint, n notice) {
	host := os.Getenv("SMTP_HOST")
	if host == "" {
		return // email not configured — in-app only
	}
	var u models.User
	if err := database.DB.Select("id", "name", "email", "status").First(&u, userID).Error; err != nil || u.Email == "" || u.Status != "active" {
		return
	}
	port := os.Getenv("SMTP_PORT")
	if port == "" {
		port = "587"
	}
	from := os.Getenv("SMTP_FROM")
	if from == "" {
		from = os.Getenv("SMTP_USER")
	}
	link := ""
	if base := strings.TrimRight(os.Getenv("APP_URL"), "/"); base != "" {
		link = "\r\n\r\nOpen the system: " + base
	}
	// Every header value goes through headerValue. The subject only had "\n"
	// replaced, so a carriage return in it — subjects include text people
	// type, e.g. a client's company name — could start a new header line
	// (an extra Bcc:, a different From:). The subject is also MIME-encoded,
	// so names in Urdu or other non-ASCII text arrive intact.
	subject := mime.QEncoding.Encode("UTF-8", headerValue(n.Title))
	body := fmt.Sprintf("Hello %s,\r\n\r\n%s%s\r\n\r\n— APEX Core", u.Name, n.Message, link)
	msg := "From: " + headerValue(from) + "\r\nTo: " + headerValue(u.Email) + "\r\nSubject: " + subject +
		"\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body
	var auth smtp.Auth
	if user := os.Getenv("SMTP_USER"); user != "" {
		auth = smtp.PlainAuth("", user, os.Getenv("SMTP_PASSWORD"), host)
	}
	if err := smtp.SendMail(host+":"+port, auth, from, []string{u.Email}, []byte(msg)); err != nil {
		log.Printf("notify: email to %s failed: %v", u.Email, err)
	}
}

// headerValue makes text safe to put in an email header: every control
// character (CR, LF, tab, ...) and Unicode line/paragraph separator becomes a
// space, so the value can never break onto a new header line.
func headerValue(s string) string {
	s = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || r == '\u2028' || r == '\u2029' || (r >= 0x80 && r < 0xa0) {
			return ' '
		}
		return r
	}, s)
	return strings.Join(strings.Fields(s), " ")
}

// ---- endpoints ----------------------------------------------------------------

func GetNotifications(c *gin.Context) {
	me := viewerFrom(c).ID
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit < 1 || limit > 200 {
		limit = 50
	}
	var rows []models.Notification
	database.DB.Where("user_id = ?", me).
		Preload("Actor", func(db *gorm.DB) *gorm.DB { return db.Select("id", "name") }).
		Order("created_at DESC, id DESC").Limit(limit).Find(&rows)
	var unread int64
	database.DB.Model(&models.Notification{}).Where("user_id = ? AND read_at IS NULL", me).Count(&unread)
	c.JSON(http.StatusOK, gin.H{"notifications": rows, "unread": unread})
}

func MarkNotificationRead(c *gin.Context) {
	now := time.Now()
	res := database.DB.Model(&models.Notification{}).
		Where("id = ? AND user_id = ? AND read_at IS NULL", c.Param("id"), viewerFrom(c).ID).
		Update("read_at", now)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update notification"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Marked as read"})
}

func MarkAllNotificationsRead(c *gin.Context) {
	now := time.Now()
	database.DB.Model(&models.Notification{}).
		Where("user_id = ? AND read_at IS NULL", viewerFrom(c).ID).Update("read_at", now)
	c.JSON(http.StatusOK, gin.H{"message": "All marked as read"})
}
