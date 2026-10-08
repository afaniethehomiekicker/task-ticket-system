package database

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"task-ticket-backend/internal/models"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	defaultSuperAdminEmail = "superadmin@example.com"
	legacyDefaultPassword  = "admin123"
)

var DB *gorm.DB

func ConnectDB() {
	// .env here uses one ready-made connection string (DB_DSN) rather than
	// five separate DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/DB_PORT fields — this
	// used to read only the five separate names, building a DSN with every
	// field empty ("host= user= password= dbname= port=...") whenever they
	// weren't set, which is not a valid connection string and fails with
	// "invalid port" before it ever reaches the database. DB_DSN is used
	// as-is when present; the five-field construction is the fallback,
	// unchanged, for setups that use it instead.
	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		host := os.Getenv("DB_HOST")
		user := os.Getenv("DB_USER")
		password := os.Getenv("DB_PASSWORD")
		dbname := os.Getenv("DB_NAME")
		port := os.Getenv("DB_PORT")
		dsn = fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=disable TimeZone=UTC",
			host, user, password, dbname, port)
	}

	var err error
	// Logging every SQL statement (the old LogMode(logger.Info)) slowed the
	// server, filled the disk and copied record contents into the logs. Now
	// only warnings, errors and slow queries are logged; set DB_LOG=info to
	// see every statement while debugging.
	logLevel := logger.Warn
	if strings.EqualFold(strings.TrimSpace(os.Getenv("DB_LOG")), "info") {
		logLevel = logger.Info
	}
	DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logLevel),
	})

	if err != nil {
		log.Fatal("Failed to connect to database: ", err)
	}
	log.Println("Database connected successfully!")

	// Connection pool. Go's default keeps only 2 idle connections, so when the
	// app loads a page (about ten requests at once) most requests had to open
	// a brand-new database connection, which takes 100-300 ms on Windows.
	// That showed up as "SLOW SQL" on simple lookups such as the per-request
	// user check. Keeping connections open removes that cost.
	if sqlDB, err := DB.DB(); err == nil {
		sqlDB.SetMaxOpenConns(50)
		sqlDB.SetMaxIdleConns(25)
		sqlDB.SetConnMaxIdleTime(10 * time.Minute)
		sqlDB.SetConnMaxLifetime(time.Hour)
	}

	// Auto-Migrate all your modern models
	err = DB.AutoMigrate(
		&models.User{},
		&models.Role{},
		&models.RolePermission{},
		&models.Client{},
		&models.Project{},
		&models.Task{},
		&models.SubTask{},
		&models.Ticket{},
		&models.ChecklistItem{},
		&models.Comment{},
		&models.Attachment{},
		&models.WorkLog{},
		&models.AuditLog{},
		&models.Feasibility{},
		// These two were missing entirely. GORM does not create a table
		// just because a parent struct (Feasibility) references it via a
		// gorm:"foreignKey:..." tag on a slice field — each table needs
		// its own explicit entry here. Without these, feasibility_vendors
		// and feasibility_attachments never get created, and every call
		// to AddFeasibilityVendor/UpdateFeasibilityVendor/
		// DeleteFeasibilityVendor fails on first use with "relation does
		// not exist."
		&models.FeasibilityVendor{},
		// Vendor master (spec slides 30-31).
		&models.Vendor{},
		&models.FeasibilityAttachment{},
		// Explicit per-record access grants (spec slide 16, record-level layer).
		&models.RecordAccess{},
		// Configurable status catalog (spec slide 21).
		&models.WorkflowStatus{},
		// Configurable SLA per priority (spec slide 22).
		&models.SLAPolicy{},
		// Admin-configurable extra client fields (spec slide 8).
		&models.ClientField{},
		// Atomic counters for permanent IDs (spec slide 7).
		&models.IDCounter{},
		// Server-side notifications (spec slide 27).
		&models.Notification{},
		// Per-person pins (spec slide 28).
		&models.Pin{},
		// "I'm working on this" markers on tasks / tickets / projects.
		&models.WorkSession{},
		// Uploaded documents / evidence (spec slides 25, 27).
		&models.Document{},
		// Missing from this list the same way FeasibilityVendor/
		// FeasibilityAttachment were above — the struct existing in
		// models.go doesn't create its table on its own; it has to be
		// named here too. Without this, every /api/departments request
		// fails with "relation \"departments\" does not exist."
		&models.Department{},
		// Spreadsheet imports of clients / vendors (who, when, which file).
		&models.ImportBatch{},
		// Requests for more time to edit a client (client_edit.go), and
		// one-time setup markers.
		&models.ClientEditRequest{},
		&models.SeedMarker{},
	)

	if err != nil {
		log.Fatal("Failed to run database migrations: ", err)
	}

	// Clients, projects, tasks, sub-tasks, tickets and feasibilities used to
	// declare an "ArchivedBy *User" relation keyed on ArchivedByID. Because
	// users have an archived_by_id column too, GORM read each one backwards
	// ("the user whose archived_by_id is this task's id") and tried to put
	// foreign keys on users.archived_by_id pointing at tasks, tickets, etc.
	// On an empty database that stopped the server from starting at all; on
	// an existing one it could make archiving a user fail. The relations were
	// never used (archived_by_id is all the code reads) and are gone; drop any
	// such constraint an earlier version created.
	for _, t := range []string{"clients", "projects", "tasks", "sub_tasks", "tickets", "feasibilities"} {
		DB.Exec(`ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_` + t + `_archived_by`)
	}
	log.Println("Database auto-migration completed successfully!")

	// Ensure a default super admin exists
	SeedSuperAdmin()
}

// SeedSuperAdmin makes sure the system has at least one super admin.
//
//   - It only acts when NO super admin exists. The old version keyed on one
//     hard-coded email, so renaming or re-emailing that account (or deleting it
//     the way the app allows) made the next restart quietly recreate a
//     super admin with the publicly known password, and it ignored every error
//     from the lookup, the hash and the insert.
//   - Credentials come from SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD. If no
//     password is set, a random one is generated and printed once. There is no
//     fixed default password any more.
//   - If an account with the legacy default password is still active, startup
//     says so on every boot.
func SeedSuperAdmin() {
	warnIfLegacyDefaultStillActive()

	var count int64
	if err := DB.Model(&models.User{}).Where("role = ?", "super_admin").Count(&count).Error; err != nil {
		log.Printf("seed: could not check for an existing super admin: %v", err)
		return
	}
	if count > 0 {
		return
	}

	email := strings.TrimSpace(os.Getenv("SUPERADMIN_EMAIL"))
	if email == "" {
		email = defaultSuperAdminEmail
	}

	password := os.Getenv("SUPERADMIN_PASSWORD")
	generated := false
	switch {
	case password == "":
		var err error
		if password, err = randomPassword(); err != nil {
			log.Printf("seed: could not generate a password, super admin NOT created: %v", err)
			return
		}
		generated = true
	case len(password) < 8:
		log.Println("seed: SUPERADMIN_PASSWORD must be at least 8 characters — super admin NOT created")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("seed: could not hash the super admin password: %v", err)
		return
	}

	admin := models.User{
		Name:       "System Admin",
		Email:      email,
		Password:   string(hash),
		Role:       "super_admin",
		Department: "Management",
		Status:     "active",
	}
	if err := DB.Create(&admin).Error; err != nil {
		log.Printf("seed: could not create the super admin (%s): %v", email, err)
		return
	}

	log.Println("========================================================")
	log.Printf("No super admin existed, so one was created: %s", email)
	if generated {
		log.Printf("Generated password (shown once): %s", password)
		log.Println("Log in and change it now.")
	} else {
		log.Println("Password taken from SUPERADMIN_PASSWORD.")
	}
	log.Println("========================================================")
}

func randomPassword() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// warnIfLegacyDefaultStillActive flags the well-known default account if its
// password was never changed.
func warnIfLegacyDefaultStillActive() {
	var u models.User
	if err := DB.Where("email = ?", defaultSuperAdminEmail).First(&u).Error; err != nil {
		return
	}
	if u.Status != "active" {
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.Password), []byte(legacyDefaultPassword)) == nil {
		log.Println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
		log.Printf("SECURITY: %s still uses the publicly known default", defaultSuperAdminEmail)
		log.Println("password. Change it or deactivate the account NOW.")
		log.Println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
	}
}
