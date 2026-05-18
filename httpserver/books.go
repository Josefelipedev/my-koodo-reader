package main

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

var bookFormats = map[string]bool{
	"epub": true, "pdf": true, "mobi": true, "azw": true, "azw3": true,
	"cbz": true, "cbr": true, "cbt": true, "cb7": true,
	"txt": true, "fb2": true, "docx": true, "md": true,
}

// ── books.db write helpers ─────────────────────────────────────────────────────

func openBooksDBWrite() (*sql.DB, error) {
	dbPath := filepath.Join(uploadDir, "config", "books.db")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", dbPath+"?_journal=WAL")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS books (
			key         TEXT PRIMARY KEY,
			name        TEXT,
			author      TEXT,
			description TEXT,
			cover       TEXT,
			format      TEXT,
			publisher   TEXT,
			size        INTEGER DEFAULT 0,
			page        INTEGER DEFAULT 0
		);
	`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func upsertBook(key, name, author, desc, cover, format, publisher string, size int64) error {
	db, err := openBooksDBWrite()
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = db.Exec(`
		INSERT INTO books (key, name, author, description, cover, format, publisher, size)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			name        = excluded.name,
			author      = excluded.author,
			description = excluded.description,
			cover       = excluded.cover,
			format      = excluded.format,
			publisher   = excluded.publisher,
			size        = excluded.size
	`, key, name, author, desc, cover, format, publisher, size)
	return err
}

func updateBookMeta(key, name, author, desc, publisher string) error {
	db, err := openBooksDBWrite()
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = db.Exec(`
		UPDATE books SET name=?, author=?, description=?, publisher=? WHERE key=?
	`, name, author, desc, publisher, key)
	return err
}

func deleteBookFromDB(key string) error {
	db, err := openBooksDBWrite()
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = db.Exec(`DELETE FROM books WHERE key = ?`, key)
	return err
}

// ── Epub metadata extraction ───────────────────────────────────────────────────

// extractXMLText is a simple (non-namespace-aware) XML text extractor.
func extractXMLText(src, tag string) string {
	open := "<" + tag
	close := "</" + tag + ">"
	start := strings.Index(src, open)
	if start == -1 {
		return ""
	}
	gt := strings.Index(src[start:], ">")
	if gt == -1 {
		return ""
	}
	content := src[start+gt+1:]
	end := strings.Index(content, close)
	if end == -1 {
		return ""
	}
	return strings.TrimSpace(content[:end])
}

func readZipEntry(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

func findZipEntry(r *zip.Reader, name string) *zip.File {
	name = strings.ToLower(strings.ReplaceAll(name, "\\", "/"))
	for _, f := range r.File {
		if strings.ToLower(strings.ReplaceAll(f.Name, "\\", "/")) == name {
			return f
		}
	}
	return nil
}

func opfPathFromContainer(data []byte) string {
	s := string(data)
	idx := strings.Index(s, "full-path=")
	if idx == -1 {
		return ""
	}
	s = s[idx+len("full-path="):]
	if len(s) == 0 {
		return ""
	}
	q := s[0]
	s = s[1:]
	end := strings.IndexByte(s, q)
	if end == -1 {
		return ""
	}
	return s[:end]
}

type epubMeta struct {
	Title     string
	Author    string
	Desc      string
	CoverData []byte
	CoverExt  string
}

func extractEpubMetadata(data []byte) epubMeta {
	var meta epubMeta
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return meta
	}

	// Locate OPF file via container.xml.
	var opfPath string
	if cf := findZipEntry(r, "meta-inf/container.xml"); cf != nil {
		cData, _ := readZipEntry(cf)
		opfPath = opfPathFromContainer(cData)
	}
	if opfPath == "" {
		for _, f := range r.File {
			if strings.HasSuffix(strings.ToLower(f.Name), ".opf") {
				opfPath = f.Name
				break
			}
		}
	}
	if opfPath == "" {
		return meta
	}

	opfFile := findZipEntry(r, strings.ToLower(opfPath))
	if opfFile == nil {
		return meta
	}
	opfData, err := readZipEntry(opfFile)
	if err != nil {
		return meta
	}
	opfStr := string(opfData)

	meta.Title = extractXMLText(opfStr, "dc:title")
	if meta.Title == "" {
		meta.Title = extractXMLText(opfStr, "title")
	}
	meta.Author = extractXMLText(opfStr, "dc:creator")
	if meta.Author == "" {
		meta.Author = extractXMLText(opfStr, "creator")
	}
	meta.Desc = extractXMLText(opfStr, "dc:description")

	// Find cover via <meta name="cover" content="{id}"> → manifest href.
	coverID := ""
	for _, attr := range []string{`name="cover"`, `name='cover'`} {
		if idx := strings.Index(opfStr, attr); idx != -1 {
			chunk := opfStr[idx:]
			for _, cattr := range []string{`content="`, `content='`} {
				if ci := strings.Index(chunk, cattr); ci != -1 {
					chunk2 := chunk[ci+len(cattr):]
					q := cattr[len(cattr)-1]
					if qi := strings.IndexByte(chunk2, q); qi != -1 {
						coverID = chunk2[:qi]
						break
					}
				}
			}
			if coverID != "" {
				break
			}
		}
	}

	var coverHref string
	if coverID != "" {
		for _, idAttr := range []string{`id="` + coverID + `"`, `id='` + coverID + `'`} {
			if idx := strings.Index(opfStr, idAttr); idx != -1 {
				chunk := opfStr[idx:]
				for _, hattr := range []string{`href="`, `href='`} {
					if hi := strings.Index(chunk, hattr); hi != -1 {
						chunk2 := chunk[hi+len(hattr):]
						q := hattr[len(hattr)-1]
						if qi := strings.IndexByte(chunk2, q); qi != -1 {
							coverHref = chunk2[:qi]
							break
						}
					}
				}
				break
			}
		}
	}

	if coverHref != "" {
		opfDir := filepath.ToSlash(filepath.Dir(opfPath))
		if opfDir == "." {
			opfDir = ""
		}
		var coverPath string
		if opfDir != "" {
			coverPath = opfDir + "/" + coverHref
		} else {
			coverPath = coverHref
		}
		if cf := findZipEntry(r, strings.ToLower(coverPath)); cf != nil {
			cData, _ := readZipEntry(cf)
			if len(cData) > 0 {
				meta.CoverData = cData
				switch strings.ToLower(filepath.Ext(coverHref)) {
				case ".jpg", ".jpeg":
					meta.CoverExt = ".jpg"
				case ".png":
					meta.CoverExt = ".png"
				case ".webp":
					meta.CoverExt = ".webp"
				default:
					meta.CoverExt = ".jpg"
				}
			}
		}
	}

	return meta
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// POST /books/upload — upload a book file; extracts epub metadata automatically.
func handleBookUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
		return
	}
	_, ok := authenticatedUser(r)
	if !ok {
		w.Header().Set("WWW-Authenticate", `Basic realm="Koodo Library"`)
		writePlain(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	ct := r.Header.Get("Content-Type")
	mediaType, params, err := mime.ParseMediaType(ct)
	if err != nil || !strings.HasPrefix(mediaType, "multipart/") {
		writePlain(w, http.StatusBadRequest, "Expected multipart/form-data")
		return
	}
	boundary := params["boundary"]
	if boundary == "" {
		writePlain(w, http.StatusBadRequest, "Missing multipart boundary")
		return
	}

	mr := multipart.NewReader(r.Body, boundary)
	var fileData []byte
	var filename, titleParam, authorParam string

	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writePlain(w, http.StatusBadRequest, "Error reading multipart data")
			return
		}
		switch part.FormName() {
		case "title":
			d, _ := io.ReadAll(part)
			titleParam = strings.TrimSpace(string(d))
		case "author":
			d, _ := io.ReadAll(part)
			authorParam = strings.TrimSpace(string(d))
		default:
			if fn := part.FileName(); fn != "" {
				filename = fn
				fileData, err = io.ReadAll(part)
				if err != nil {
					part.Close()
					writePlain(w, http.StatusInternalServerError, "Internal Server Error")
					return
				}
			}
		}
		part.Close()
	}

	if len(fileData) == 0 || filename == "" {
		writePlain(w, http.StatusBadRequest, "No file uploaded")
		return
	}

	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filename), "."))
	if !bookFormats[ext] {
		writePlain(w, http.StatusBadRequest, fmt.Sprintf("Unsupported format: %s", ext))
		return
	}

	key := strconv.FormatInt(time.Now().UnixMilli(), 10)

	// Save book file to uploads/book/{key}.{ext} (shared library)
	bookDir := filepath.Join(uploadDir, "book")
	if err := os.MkdirAll(bookDir, 0o755); err != nil {
		writePlain(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if err := os.WriteFile(filepath.Join(bookDir, key+"."+ext), fileData, 0o644); err != nil {
		log.Printf("[books] write error: %v", err)
		writePlain(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}

	// Extract epub metadata when not provided.
	title, author, desc, coverField := titleParam, authorParam, "", ""
	if ext == "epub" {
		meta := extractEpubMetadata(fileData)
		if title == "" {
			title = meta.Title
		}
		if author == "" {
			author = meta.Author
		}
		if desc == "" {
			desc = meta.Desc
		}
		if len(meta.CoverData) > 0 {
			coverDir := filepath.Join(uploadDir, "cover")
			_ = os.MkdirAll(coverDir, 0o755)
			coverFilename := key + meta.CoverExt
			if err := os.WriteFile(filepath.Join(coverDir, coverFilename), meta.CoverData, 0o644); err == nil {
				coverField = coverFilename
			}
		}
	}
	if title == "" {
		title = strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))
	}

	if err := upsertBook(key, title, author, desc, coverField, ext, "", int64(len(fileData))); err != nil {
		log.Printf("[books] upsert error: %v", err)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"key":     key,
		"title":   title,
		"author":  author,
		"format":  ext,
		"size":    len(fileData),
		"cover":   coverField,
	})
}

// PUT /books/{key} — update book metadata (admin only)
func handleBookUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
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

	key := strings.Trim(strings.TrimPrefix(r.URL.Path, "/books/"), "/")
	if key == "" {
		writePlain(w, http.StatusBadRequest, "Missing book key")
		return
	}

	var body struct {
		Name      string `json:"name"`
		Author    string `json:"author"`
		Desc      string `json:"description"`
		Publisher string `json:"publisher"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writePlain(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	if err := updateBookMeta(key, body.Name, body.Author, body.Desc, body.Publisher); err != nil {
		log.Printf("[books] update error: %v", err)
		writePlain(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "key": key})
}

// DELETE /books/{key} — remove a book (admin only)
func handleBookDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
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

	key := strings.TrimPrefix(r.URL.Path, "/books/")
	key = strings.Trim(key, "/")
	if key == "" {
		writePlain(w, http.StatusBadRequest, "Missing book key")
		return
	}

	// Look up format + cover before deleting DB record.
	var format, cover string
	if db, err := openBooksDB(); err == nil {
		_ = db.QueryRow(`SELECT COALESCE(format,''), COALESCE(cover,'') FROM books WHERE key = ?`, key).
			Scan(&format, &cover)
		db.Close()
	}

	if format != "" {
		_ = os.Remove(filepath.Join(uploadDir, "book", key+"."+format))
	}
	if cover != "" {
		_ = os.Remove(filepath.Join(uploadDir, "cover", cover))
	}

	if err := deleteBookFromDB(key); err != nil {
		log.Printf("[books] delete error: %v", err)
		writePlain(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "key": key})
}

// GET /books/list — list all books from the shared catalog
func handleBooksList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
		return
	}
	_, ok := authenticatedUser(r)
	if !ok {
		writePlain(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	db, err := openBooksDB()
	if err != nil {
		writePlain(w, http.StatusInternalServerError, "Database unavailable")
		return
	}
	defer db.Close()

	books, err := queryBooks(db, "")
	if err != nil {
		writePlain(w, http.StatusInternalServerError, "Query error")
		return
	}

	type item struct {
		Key         string `json:"key"`
		Name        string `json:"name"`
		Author      string `json:"author"`
		Description string `json:"description"`
		Publisher   string `json:"publisher"`
		Format      string `json:"format"`
		Cover       string `json:"cover"`
		Size        int64  `json:"size"`
	}
	result := make([]item, 0, len(books))
	for _, b := range books {
		result = append(result, item{
			Key: b.Key, Name: b.Name, Author: b.Author,
			Description: b.Description, Publisher: b.Publisher,
			Format: b.Format, Cover: b.Cover, Size: b.Size,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "books": result, "total": len(result)})
}
