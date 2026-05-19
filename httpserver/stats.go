package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func openStatsDB() (*sql.DB, error) {
	path := filepath.Join(uploadDir, "config", "stats.db")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path+"?_journal=WAL")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS reading_activity (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			username     TEXT    NOT NULL,
			book_key     TEXT    NOT NULL,
			book_name    TEXT,
			book_author  TEXT,
			format       TEXT,
			first_opened INTEGER NOT NULL,
			last_seen    INTEGER NOT NULL,
			open_count   INTEGER NOT NULL DEFAULT 1,
			UNIQUE(username, book_key)
		)
	`); err != nil {
		db.Close()
		return nil, err
	}
	if _, err = db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_activity_user ON reading_activity(username, last_seen DESC)
	`); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// POST /stats/open — upsert a book-open event for the authenticated user.
func handleStatsOpen(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
		return
	}
	user, ok := authenticatedUser(r)
	if !ok {
		writePlain(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	var body struct {
		BookKey    string `json:"book_key"`
		BookName   string `json:"book_name"`
		BookAuthor string `json:"book_author"`
		Format     string `json:"format"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.BookKey == "" {
		writePlain(w, http.StatusBadRequest, "Invalid request")
		return
	}

	db, err := openStatsDB()
	if err != nil {
		log.Printf("[stats] db error: %v", err)
		writePlain(w, http.StatusInternalServerError, "DB error")
		return
	}
	defer db.Close()

	now := time.Now().Unix()
	_, err = db.Exec(`
		INSERT INTO reading_activity (username, book_key, book_name, book_author, format, first_opened, last_seen, open_count)
		VALUES (?, ?, ?, ?, ?, ?, ?, 1)
		ON CONFLICT(username, book_key) DO UPDATE SET
			book_name   = excluded.book_name,
			book_author = excluded.book_author,
			format      = excluded.format,
			last_seen   = excluded.last_seen,
			open_count  = open_count + 1
	`, user.Username, body.BookKey, body.BookName, body.BookAuthor, body.Format, now, now)
	if err != nil {
		log.Printf("[stats] upsert error: %v", err)
		writePlain(w, http.StatusInternalServerError, "DB error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// GET /stats/me — authenticated user's recent reading activity.
func handleStatsMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
		return
	}
	user, ok := authenticatedUser(r)
	if !ok {
		writePlain(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	db, err := openStatsDB()
	if err != nil {
		writePlain(w, http.StatusInternalServerError, "DB error")
		return
	}
	defer db.Close()

	rows, err := db.Query(`
		SELECT book_key, book_name, book_author, format, first_opened, last_seen, open_count
		FROM reading_activity
		WHERE username = ?
		ORDER BY last_seen DESC
		LIMIT 50
	`, user.Username)
	if err != nil {
		writePlain(w, http.StatusInternalServerError, "Query error")
		return
	}
	defer rows.Close()

	type entry struct {
		BookKey     string `json:"book_key"`
		BookName    string `json:"book_name"`
		BookAuthor  string `json:"book_author"`
		Format      string `json:"format"`
		FirstOpened int64  `json:"first_opened"`
		LastSeen    int64  `json:"last_seen"`
		OpenCount   int    `json:"open_count"`
	}
	items := []entry{}
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.BookKey, &e.BookName, &e.BookAuthor, &e.Format,
			&e.FirstOpened, &e.LastSeen, &e.OpenCount); err != nil {
			continue
		}
		items = append(items, e)
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "activity": items, "total": len(items)})
}

// GET /stats/users — admin: per-user activity summary.
func handleStatsUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
		return
	}
	user, ok := authenticatedUser(r)
	if !ok {
		writePlain(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	if user.Role != "admin" {
		writePlain(w, http.StatusForbidden, "Forbidden: admin only")
		return
	}

	db, err := openStatsDB()
	if err != nil {
		writePlain(w, http.StatusInternalServerError, "DB error")
		return
	}
	defer db.Close()

	rows, err := db.Query(`
		SELECT username, COUNT(*) as books_count, MAX(last_seen) as last_active, SUM(open_count) as total_opens
		FROM reading_activity
		GROUP BY username
		ORDER BY last_active DESC
	`)
	if err != nil {
		writePlain(w, http.StatusInternalServerError, "Query error")
		return
	}
	defer rows.Close()

	type summary struct {
		Username   string `json:"username"`
		BooksCount int    `json:"books_count"`
		LastActive int64  `json:"last_active"`
		TotalOpens int    `json:"total_opens"`
	}
	items := []summary{}
	for rows.Next() {
		var s summary
		if err := rows.Scan(&s.Username, &s.BooksCount, &s.LastActive, &s.TotalOpens); err != nil {
			continue
		}
		items = append(items, s)
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "users": items})
}

// GET /stats/user/{username} — admin: detailed activity for one user.
func handleStatsUserDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
		return
	}
	caller, ok := authenticatedUser(r)
	if !ok {
		writePlain(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	if caller.Role != "admin" {
		writePlain(w, http.StatusForbidden, "Forbidden: admin only")
		return
	}

	target := r.URL.Query().Get("username")
	if target == "" {
		writePlain(w, http.StatusBadRequest, "Missing username parameter")
		return
	}

	db, err := openStatsDB()
	if err != nil {
		writePlain(w, http.StatusInternalServerError, "DB error")
		return
	}
	defer db.Close()

	rows, err := db.Query(`
		SELECT book_key, book_name, book_author, format, first_opened, last_seen, open_count
		FROM reading_activity
		WHERE username = ?
		ORDER BY last_seen DESC
		LIMIT 50
	`, target)
	if err != nil {
		writePlain(w, http.StatusInternalServerError, "Query error")
		return
	}
	defer rows.Close()

	type entry struct {
		BookKey     string `json:"book_key"`
		BookName    string `json:"book_name"`
		BookAuthor  string `json:"book_author"`
		Format      string `json:"format"`
		FirstOpened int64  `json:"first_opened"`
		LastSeen    int64  `json:"last_seen"`
		OpenCount   int    `json:"open_count"`
	}
	items := []entry{}
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.BookKey, &e.BookName, &e.BookAuthor, &e.Format,
			&e.FirstOpened, &e.LastSeen, &e.OpenCount); err != nil {
			continue
		}
		items = append(items, e)
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "activity": items, "username": target})
}
