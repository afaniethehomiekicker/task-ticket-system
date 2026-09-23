package handlers

import (
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"crypto/rand"
	"encoding/hex"

	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
)

// POST /api/upload   multipart/form-data, field "avatar"   ->   { "url": "/uploads/avatars/<name>" }
//
// Profile-picture upload only. Files land in ./uploads/avatars, which
// r.Static("/uploads", "./uploads") in routes.go already serves — publicly,
// with no auth. That is fine for avatars but is NOT where documents or
// evidence (which the spec says must be permission-controlled) should go.
//
// The client's filename and Content-Type are never trusted: the type is
// sniffed from the file's first bytes, only raster images are accepted (no
// SVG — it can carry scripts), and the stored name is random.

const (
	maxAvatarBytes  = 5 << 20 // 5 MB
	avatarUploadDir = "./uploads/avatars"
	avatarURLPrefix = "/uploads/avatars/"
)

var allowedAvatarTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

func UploadAvatar(c *gin.Context) {
	userIDVal, _ := c.Get("user_id")
	userID, _ := userIDVal.(uint)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	// Reject oversized bodies before they're buffered (1 MB of slack for the
	// multipart envelope).
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAvatarBytes+(1<<20))

	fileHeader, err := c.FormFile("avatar")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No image received (expected multipart field \"avatar\", max 5 MB)"})
		return
	}
	if fileHeader.Size > maxAvatarBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Image is too large (max 5 MB)"})
		return
	}

	src, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Could not read uploaded file"})
		return
	}
	defer src.Close()

	head := make([]byte, 512)
	n, err := io.ReadFull(src, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Could not read uploaded file"})
		return
	}
	ext, ok := allowedAvatarTypes[http.DetectContentType(head[:n])]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported image type (use JPEG, PNG, GIF or WebP)"})
		return
	}
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process upload"})
		return
	}

	nameBytes := make([]byte, 16)
	if _, err := rand.Read(nameBytes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process upload"})
		return
	}
	filename := hex.EncodeToString(nameBytes) + ext

	if err := os.MkdirAll(avatarUploadDir, 0o755); err != nil {
		log.Printf("upload: cannot create %s: %v", avatarUploadDir, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store upload"})
		return
	}
	dstPath := filepath.Join(avatarUploadDir, filename)
	dst, err := os.OpenFile(dstPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		log.Printf("upload: cannot create %s: %v", dstPath, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store upload"})
		return
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		os.Remove(dstPath)
		log.Printf("upload: write to %s failed: %v", dstPath, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store upload"})
		return
	}
	if err := dst.Close(); err != nil {
		os.Remove(dstPath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store upload"})
		return
	}

	utils.LogAudit(userID, "avatar_uploaded", "user", userID,
		"Uploaded a new profile picture", c.ClientIP(), c.Request.UserAgent())

	c.JSON(http.StatusOK, gin.H{"url": avatarURLPrefix + filename})
}
