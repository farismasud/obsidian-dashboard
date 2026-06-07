package handlers

import (
	"net/http"
	"path/filepath"
	"sort"
	"strings"

	"obsidian-dashboard/parser"

	"github.com/gin-gonic/gin"
)

type NoteResponse struct {
	Path        string         `json:"path"`
	Title       string         `json:"title"`
	Folder      string         `json:"folder"`
	Tags        []string       `json:"tags"`
	Links       []string       `json:"links"`
	Backlinks   []string       `json:"backlinks"`
	Frontmatter map[string]any `json:"frontmatter"`
	ModTime     string         `json:"mod_time"`
	Excerpt     string         `json:"excerpt"`
}

type NoteDetailResponse struct {
	NoteResponse
	HTMLContent string `json:"html_content"`
	Content     string `json:"content"`
}

func toResponse(n *parser.Note) NoteResponse {
	tags := n.Tags
	if tags == nil {
		tags = []string{}
	}
	links := n.Links
	if links == nil {
		links = []string{}
	}
	backlinks := n.Backlinks
	if backlinks == nil {
		backlinks = []string{}
	}
	return NoteResponse{
		Path:        n.Path,
		Title:       n.Title,
		Folder:      n.Folder,
		Tags:        tags,
		Links:       links,
		Backlinks:   backlinks,
		Frontmatter: n.Frontmatter,
		ModTime:     n.ModTime.Format("2006-01-02T15:04:05Z"),
		Excerpt:     n.Excerpt,
	}
}

func GetNotes(vault *parser.Vault) gin.HandlerFunc {
	return func(c *gin.Context) {
		folder := c.Query("folder")
		notes := vault.GetNotes()

		// Sort by mod time desc
		sort.Slice(notes, func(i, j int) bool {
			return notes[i].ModTime.After(notes[j].ModTime)
		})

		var result []NoteResponse
		for _, n := range notes {
			if folder != "" && !strings.EqualFold(n.Folder, folder) {
				continue
			}
			result = append(result, toResponse(n))
		}
		if result == nil {
			result = []NoteResponse{}
		}
		c.JSON(http.StatusOK, result)
	}
}

func GetNote(vault *parser.Vault) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Param("path")
		path = strings.TrimPrefix(path, "/")

		note, ok := vault.GetNote(path)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
			return
		}

		resp := NoteDetailResponse{
			NoteResponse: toResponse(note),
			HTMLContent:  note.HTMLContent,
			Content:      note.Content,
		}
		c.JSON(http.StatusOK, resp)
	}
}

func GetProjects(vault *parser.Vault) gin.HandlerFunc {
	return func(c *gin.Context) {
		notes := vault.GetNotes()
		sort.Slice(notes, func(i, j int) bool {
			return notes[i].ModTime.After(notes[j].ModTime)
		})

		var result []NoteResponse
		for _, n := range notes {
			if strings.HasPrefix(n.Folder, "Projects") || strings.EqualFold(n.Folder, "projects") {
				result = append(result, toResponse(n))
			}
		}
		if result == nil {
			result = []NoteResponse{}
		}
		c.JSON(http.StatusOK, result)
	}
}

func GetStats(vault *parser.Vault) gin.HandlerFunc {
	return func(c *gin.Context) {
		notes := vault.GetNotes()

		folders := make(map[string]int)
		var lastMod string
		for _, n := range notes {
			folders[n.Folder]++
			t := n.ModTime.Format("2006-01-02T15:04:05Z")
			if t > lastMod {
				lastMod = t
			}
		}

		// Recent 5 notes
		sort.Slice(notes, func(i, j int) bool {
			return notes[i].ModTime.After(notes[j].ModTime)
		})
		recent := make([]NoteResponse, 0, 5)
		for i, n := range notes {
			if i >= 5 {
				break
			}
			recent = append(recent, toResponse(n))
		}

		// Project count
		projectCount := 0
		for _, n := range notes {
			if strings.HasPrefix(filepath.ToSlash(n.Folder), "Projects") {
				projectCount++
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"total_notes":   len(notes),
			"project_count": projectCount,
			"folders":       folders,
			"last_modified": lastMod,
			"recent_notes":  recent,
		})
	}
}

func Search(vault *parser.Vault) gin.HandlerFunc {
	return func(c *gin.Context) {
		q := strings.TrimSpace(c.Query("q"))
		if q == "" {
			c.JSON(http.StatusOK, []NoteResponse{})
			return
		}
		notes := vault.Search(q)
		result := make([]NoteResponse, 0, len(notes))
		for _, n := range notes {
			result = append(result, toResponse(n))
		}
		c.JSON(http.StatusOK, result)
	}
}
