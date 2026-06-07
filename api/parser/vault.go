package parser

import (
	"bytes"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/yuin/goldmark"
	"gopkg.in/yaml.v3"
)

type Note struct {
	Path        string            `json:"path"`
	Title       string            `json:"title"`
	Folder      string            `json:"folder"`
	Content     string            `json:"content"`
	HTMLContent string            `json:"html_content"`
	Tags        []string          `json:"tags"`
	Links       []string          `json:"links"`
	Backlinks   []string          `json:"backlinks"`
	Frontmatter map[string]any    `json:"frontmatter"`
	ModTime     time.Time         `json:"mod_time"`
	Excerpt     string            `json:"excerpt"`
}

type Vault struct {
	mu        sync.RWMutex
	VaultPath string
	Notes     map[string]*Note // key = relative path
	md        goldmark.Markdown
}

var backlinkRe = regexp.MustCompile(`\[\[([^\]|#]+)(?:\|[^\]]+)?(?:#[^\]]+)?\]\]`)
var frontmatterRe = regexp.MustCompile(`(?s)^---\n(.+?)\n---\n?`)

func NewVault(vaultPath string) *Vault {
	return &Vault{
		VaultPath: vaultPath,
		Notes:     make(map[string]*Note),
		md:        goldmark.New(),
	}
}

func (v *Vault) Load() error {
	v.mu.Lock()
	defer v.mu.Unlock()

	notes := make(map[string]*Note)

	err := filepath.Walk(v.VaultPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() && strings.HasPrefix(info.Name(), ".") {
			return filepath.SkipDir
		}
		if !info.IsDir() && strings.HasSuffix(path, ".md") {
			relPath, _ := filepath.Rel(v.VaultPath, path)
			note, parseErr := v.parseFile(path, relPath, info.ModTime())
			if parseErr == nil {
				notes[relPath] = note
			}
		}
		return nil
	})
	if err != nil {
		return err
	}

	v.Notes = notes
	v.buildBacklinks()
	return nil
}

func (v *Vault) ReloadFile(absPath string) {
	v.mu.Lock()
	defer v.mu.Unlock()

	relPath, err := filepath.Rel(v.VaultPath, absPath)
	if err != nil {
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		delete(v.Notes, relPath)
		v.buildBacklinks()
		return
	}

	note, err := v.parseFile(absPath, relPath, info.ModTime())
	if err == nil {
		v.Notes[relPath] = note
	}
	v.buildBacklinks()
}

func (v *Vault) parseFile(absPath, relPath string, modTime time.Time) (*Note, error) {
	data, err := os.ReadFile(absPath)
	if err != nil {
		return nil, err
	}

	raw := string(data)
	frontmatter := make(map[string]any)
	var tags []string
	body := raw

	if m := frontmatterRe.FindStringSubmatch(raw); len(m) == 2 {
		_ = yaml.Unmarshal([]byte(m[1]), &frontmatter)
		body = raw[len(m[0]):]
		if t, ok := frontmatter["tags"]; ok {
			switch tv := t.(type) {
			case []any:
				for _, tag := range tv {
					if s, ok := tag.(string); ok {
						tags = append(tags, s)
					}
				}
			case string:
				tags = strings.Fields(tv)
			}
		}
	}

	// Extract [[links]]
	matches := backlinkRe.FindAllStringSubmatch(body, -1)
	links := make([]string, 0, len(matches))
	seen := make(map[string]bool)
	for _, m := range matches {
		target := strings.TrimSpace(m[1])
		if !seen[target] {
			links = append(links, target)
			seen[target] = true
		}
	}

	// Render markdown to HTML
	var buf bytes.Buffer
	_ = v.md.Convert([]byte(body), &buf)
	html := buf.String()

	// Title: frontmatter title > first H1 > filename
	title := ""
	if t, ok := frontmatter["title"].(string); ok {
		title = t
	}
	if title == "" {
		for _, line := range strings.SplitN(body, "\n", 10) {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "# ") {
				title = strings.TrimPrefix(line, "# ")
				break
			}
		}
	}
	if title == "" {
		base := filepath.Base(relPath)
		title = strings.TrimSuffix(base, ".md")
	}

	// Excerpt: first 200 chars of body text
	plain := strings.TrimSpace(body)
	plain = regexp.MustCompile(`(?m)^#{1,6}\s+`).ReplaceAllString(plain, "")
	plain = backlinkRe.ReplaceAllString(plain, "$1")
	plain = strings.Join(strings.Fields(plain), " ")
	excerpt := plain
	if len(excerpt) > 200 {
		excerpt = excerpt[:200] + "…"
	}

	folder := filepath.Dir(relPath)
	if folder == "." {
		folder = "root"
	}

	return &Note{
		Path:        relPath,
		Title:       title,
		Folder:      folder,
		Content:     body,
		HTMLContent: html,
		Tags:        tags,
		Links:       links,
		Backlinks:   []string{},
		Frontmatter: frontmatter,
		ModTime:     modTime,
		Excerpt:     excerpt,
	}, nil
}

func (v *Vault) buildBacklinks() {
	// Clear existing backlinks
	for _, note := range v.Notes {
		note.Backlinks = []string{}
	}

	// titleToPath index
	titleToPath := make(map[string]string)
	for relPath, note := range v.Notes {
		titleToPath[strings.ToLower(note.Title)] = relPath
		// Also index by filename without extension
		base := strings.ToLower(strings.TrimSuffix(filepath.Base(relPath), ".md"))
		titleToPath[base] = relPath
	}

	for _, note := range v.Notes {
		for _, link := range note.Links {
			lower := strings.ToLower(link)
			if targetPath, ok := titleToPath[lower]; ok {
				if target, exists := v.Notes[targetPath]; exists {
					target.Backlinks = append(target.Backlinks, note.Path)
				}
			}
		}
	}
}

func (v *Vault) GetNotes() []*Note {
	v.mu.RLock()
	defer v.mu.RUnlock()
	notes := make([]*Note, 0, len(v.Notes))
	for _, n := range v.Notes {
		notes = append(notes, n)
	}
	return notes
}

func (v *Vault) GetNote(relPath string) (*Note, bool) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	n, ok := v.Notes[relPath]
	return n, ok
}

func (v *Vault) Search(query string) []*Note {
	v.mu.RLock()
	defer v.mu.RUnlock()
	query = strings.ToLower(query)
	var results []*Note
	for _, note := range v.Notes {
		if strings.Contains(strings.ToLower(note.Title), query) ||
			strings.Contains(strings.ToLower(note.Content), query) {
			results = append(results, note)
		}
	}
	return results
}
