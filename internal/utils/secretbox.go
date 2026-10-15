package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"log"
	"os"
	"strings"
	"sync"
)

// Secret fields stored in the database (Transmission Plan passwords) are
// encrypted with AES-256-GCM. The key comes from PLAN_SECRET_KEY in .env:
// any long random value (e.g. `openssl rand -hex 32`); it is hashed to 32
// bytes, so its exact length doesn't matter.
//
// KEEP THE KEY SAFE AND NEVER CHANGE IT once passwords are saved: without the
// same key they can no longer be read. It is deliberately separate from
// JWT_SECRET, so rotating login tokens never touches stored passwords.
//
// In release mode (GIN_MODE=release) without PLAN_SECRET_KEY, secrets simply
// can't be saved (ErrSecretKeyMissing) — nothing silently falls back. In
// development a fixed key derived from JWT_SECRET is used, with a warning.

const secretPrefix = "v1:"

var ErrSecretKeyMissing = errors.New("PLAN_SECRET_KEY is not set on the server, so passwords can't be stored")

var (
	secretOnce sync.Once
	secretAEAD cipher.AEAD
)

func secretCipher() cipher.AEAD {
	secretOnce.Do(func() {
		raw := strings.TrimSpace(os.Getenv("PLAN_SECRET_KEY"))
		if raw == "" {
			if os.Getenv("GIN_MODE") == "release" {
				log.Println("WARNING: PLAN_SECRET_KEY is not set: Transmission Plan passwords can't be saved or shown until it is.")
				return
			}
			jwt := os.Getenv("JWT_SECRET")
			if jwt == "" {
				log.Println("WARNING: PLAN_SECRET_KEY and JWT_SECRET are not set: Transmission Plan passwords can't be saved.")
				return
			}
			log.Println("WARNING: PLAN_SECRET_KEY is not set; using a development key derived from JWT_SECRET. Set PLAN_SECRET_KEY before production.")
			raw = "dev-plan-secret:" + jwt
		} else if len(raw) < 32 {
			log.Println("WARNING: PLAN_SECRET_KEY is shorter than 32 characters. Use a long random value (e.g. `openssl rand -hex 32`).")
		}
		key := sha256.Sum256([]byte(raw))
		block, err := aes.NewCipher(key[:])
		if err != nil {
			log.Printf("secretbox: %v", err)
			return
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			log.Printf("secretbox: %v", err)
			return
		}
		secretAEAD = aead
	})
	return secretAEAD
}

// SecretsAvailable reports whether secrets can be encrypted / decrypted.
func SecretsAvailable() bool { return secretCipher() != nil }

// EncryptSecret returns the stored form of a secret. An empty secret stays
// empty (nothing to protect).
func EncryptSecret(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	aead := secretCipher()
	if aead == nil {
		return "", ErrSecretKeyMissing
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := aead.Seal(nonce, nonce, []byte(plain), nil)
	return secretPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// DecryptSecret reverses EncryptSecret.
func DecryptSecret(stored string) (string, error) {
	if stored == "" {
		return "", nil
	}
	if !strings.HasPrefix(stored, secretPrefix) {
		return "", errors.New("stored secret has an unknown format")
	}
	aead := secretCipher()
	if aead == nil {
		return "", ErrSecretKeyMissing
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, secretPrefix))
	if err != nil {
		return "", errors.New("stored secret is damaged")
	}
	ns := aead.NonceSize()
	if len(data) < ns {
		return "", errors.New("stored secret is damaged")
	}
	plain, err := aead.Open(nil, data[:ns], data[ns:], nil)
	if err != nil {
		return "", errors.New("stored secret can't be read with the current PLAN_SECRET_KEY")
	}
	return string(plain), nil
}
