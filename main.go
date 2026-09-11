package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/handlers"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/routes"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

//go:embed frontend/dist/*
var frontendFiles embed.FS

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, relying on system environment")
	}

	database.ConnectDB()

	// Migrate schema BEFORE seeding anything into it. This used to run
	// after SeedSuperAdmin(), which meant a genuinely fresh database (no
	// `users` table yet) would crash the whole server on first boot —
	// SeedSuperAdmin's DB.Create call fails when the table doesn't exist,
	// and seed.go calls log.Fatal on that error. Masked previously only
	// because the DB already had the table from a prior run.
	err := database.DB.AutoMigrate(
		&models.User{},
		&models.Project{},
		&models.Task{},
		&models.Ticket{},
		&models.SubTask{},
		&models.Comment{},
		&models.AuditLog{},
	)
	if err != nil {
		log.Fatal("Migration failed: ", err)
	}

	// Seed Super Admin automatically on boot
	database.SeedSuperAdmin()

	// Seed the fixed demo accounts once at startup — NOT on every request
	// (see handlers.GetUsers / handlers.SeedDemoUsers for why that used to
	// be a duplicate-user-creating race condition).
	handlers.SeedDemoUsers()

	r := gin.Default()

	// Configure and add CORS middleware so React can talk to the backend
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:5173", "http://localhost:8080"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "x-user-role"},
		AllowCredentials: true,
	}))

	routes.RegisterRoutes(r)

	// Setup embedded frontend file system
	subFS, err := fs.Sub(frontendFiles, "frontend/dist")
	if err != nil {
		log.Fatal("Failed to sub embed filesystem: ", err)
	}

	// Serve React static files and handle SPA routing cleanly
	r.Use(func(c *gin.Context) {
		path := c.Request.URL.Path
		if len(path) >= 4 && path[:4] == "/api" {
			c.Next()
			return
		}

		// Normalize path for lookup inside dist
		fPath := path
		if len(fPath) > 0 && fPath[0] == '/' {
			fPath = fPath[1:]
		}
		if fPath == "" {
			fPath = "index.html"
		}

		// Check if file exists in subFS
		if f, err := subFS.Open(fPath); err == nil {
			f.Close()
			http.FileServer(http.FS(subFS)).ServeHTTP(c.Writer, c.Request)
			c.Abort()
			return
		}

		// Fallback to index.html for React router paths
		indexHTML, err := fs.ReadFile(subFS, "index.html")
		if err != nil {
			c.String(404, "index.html not found in embed")
			return
		}
		c.Data(200, "text/html; charset=utf-8", indexHTML)
		c.Abort()
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server running smoothly on port %s...", port)
	r.Run(":" + port)
}
