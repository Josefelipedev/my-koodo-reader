package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type appUser struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	CreatedAt int64  `json:"createdAt"`
}

var userDB *sql.DB

func generateRandom(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func hashPassword(salt, password string) string {
	h := sha256.Sum256([]byte(salt + ":" + password))
	return hex.EncodeToString(h[:])
}

func initUserDB() {
	dbDir := filepath.Join(uploadDir, "config")
	if err := os.MkdirAll(dbDir, 0o755); err != nil {
		log.Fatalf("[auth] Cannot create config directory: %v", err)
	}

	dbPath := filepath.Join(dbDir, "users.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("[auth] Cannot open users database: %v", err)
	}
	db.SetMaxOpenConns(1)

	if _, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS app_users (
			id         TEXT PRIMARY KEY,
			username   TEXT UNIQUE NOT NULL,
			salt       TEXT NOT NULL,
			password   TEXT NOT NULL,
			role       TEXT NOT NULL DEFAULT 'member',
			created_at INTEGER NOT NULL
		);
	`); err != nil {
		log.Fatalf("[auth] Migration failed: %v", err)
	}

	userDB = db

	// Seed admin user from env credentials if no users exist yet.
	var count int
	_ = db.QueryRow(`SELECT COUNT(*) FROM app_users`).Scan(&count)
	if count == 0 {
		if err := dbCreateUser(credentials.username, credentials.password, "admin"); err != nil {
			log.Fatalf("[auth] Cannot seed admin user: %v", err)
		}
		log.Printf("[auth] Admin user '%s' seeded from environment variables", credentials.username)
		log.Println("[auth] Manage users via POST /admin/users (admin credentials required)")
	}
}

func dbCreateUser(username, password, role string) error {
	salt := generateRandom(16)
	hash := hashPassword(salt, password)
	id := generateRandom(16)
	_, err := userDB.Exec(
		`INSERT INTO app_users (id, username, salt, password, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		id, username, salt, hash, role, time.Now().Unix(),
	)
	return err
}

func dbVerifyUser(username, password string) (*appUser, bool) {
	var u appUser
	var salt, storedHash string
	err := userDB.QueryRow(
		`SELECT id, username, salt, password, role, created_at FROM app_users WHERE username = ?`, username,
	).Scan(&u.ID, &u.Username, &salt, &storedHash, &u.Role, &u.CreatedAt)
	if err != nil {
		return nil, false
	}
	if hashPassword(salt, password) != storedHash {
		return nil, false
	}
	return &u, true
}

func dbListUsers() []appUser {
	rows, err := userDB.Query(`SELECT id, username, role, created_at FROM app_users ORDER BY created_at`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var users []appUser
	for rows.Next() {
		var u appUser
		if err := rows.Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt); err == nil {
			users = append(users, u)
		}
	}
	return users
}

func dbDeleteUser(username string) error {
	_, err := userDB.Exec(`DELETE FROM app_users WHERE username = ?`, username)
	return err
}

// authenticatedUser parses Basic Auth from the request and validates against the user DB.
func authenticatedUser(r *http.Request) (*appUser, bool) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return nil, false
	}
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || parts[0] != "Basic" {
		return nil, false
	}
	decoded, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, false
	}
	pair := strings.SplitN(string(decoded), ":", 2)
	if len(pair) != 2 {
		return nil, false
	}
	return dbVerifyUser(pair[0], pair[1])
}

// handleAdminUsers serves GET/POST/DELETE /admin/users[/{username}].
// Requires admin role.
func handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	user, ok := authenticatedUser(r)
	if !ok {
		w.Header().Set("WWW-Authenticate", `Basic realm="Admin"`)
		writePlain(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	if user.Role != "admin" {
		writePlain(w, http.StatusForbidden, "Forbidden: admin role required")
		return
	}

	// Optional username segment: /admin/users/{username}
	usernameParam := strings.TrimPrefix(r.URL.Path, "/admin/users")
	usernameParam = strings.Trim(usernameParam, "/")

	switch r.Method {
	case http.MethodGet:
		users := dbListUsers()
		if users == nil {
			users = []appUser{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "users": users})

	case http.MethodPost:
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
			Role     string `json:"role"`
		}
		if err := decodeJSON(r, &body); err != nil || body.Username == "" || body.Password == "" {
			writePlain(w, http.StatusBadRequest, "username and password are required")
			return
		}
		if body.Role == "" {
			body.Role = "member"
		}
		if body.Role != "admin" && body.Role != "member" {
			writePlain(w, http.StatusBadRequest, "role must be 'admin' or 'member'")
			return
		}
		if err := dbCreateUser(body.Username, body.Password, body.Role); err != nil {
			if strings.Contains(err.Error(), "UNIQUE") {
				writePlain(w, http.StatusConflict, "Username already exists")
				return
			}
			log.Printf("[auth] create user error: %v", err)
			writePlain(w, http.StatusInternalServerError, "Internal Server Error")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"success":  true,
			"username": body.Username,
			"role":     body.Role,
		})

	case http.MethodDelete:
		if usernameParam == "" {
			writePlain(w, http.StatusBadRequest, "specify username in path: /admin/users/{username}")
			return
		}
		if usernameParam == user.Username {
			writePlain(w, http.StatusBadRequest, "cannot delete your own account")
			return
		}
		if err := dbDeleteUser(usernameParam); err != nil {
			log.Printf("[auth] delete user error: %v", err)
			writePlain(w, http.StatusInternalServerError, "Internal Server Error")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"success":  true,
			"username": usernameParam,
			"message":  "User deleted",
		})

	default:
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
	}
}
