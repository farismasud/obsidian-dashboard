package handlers

import (
	"net/http"
	"path/filepath"

	"obsidian-dashboard/parser"

	"github.com/gin-gonic/gin"
)

type GraphNode struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Folder string `json:"folder"`
	Group  string `json:"group"`
}

type GraphLink struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

type GraphData struct {
	Nodes []GraphNode `json:"nodes"`
	Links []GraphLink `json:"links"`
}

func GetGraph(vault *parser.Vault) gin.HandlerFunc {
	return func(c *gin.Context) {
		notes := vault.GetNotes()

		// Build title → path index for link resolution
		titleToPath := make(map[string]string)
		for _, n := range notes {
			titleToPath[n.Title] = n.Path
			base := filepath.Base(n.Path)
			titleToPath[base[:len(base)-3]] = n.Path // without .md
		}

		nodes := make([]GraphNode, 0, len(notes))
		for _, n := range notes {
			nodes = append(nodes, GraphNode{
				ID:     n.Path,
				Title:  n.Title,
				Folder: n.Folder,
				Group:  topFolder(n.Folder),
			})
		}

		// Deduplicate links
		type edge struct{ s, t string }
		seen := make(map[edge]bool)
		links := []GraphLink{}

		for _, n := range notes {
			for _, link := range n.Links {
				target := ""
				if p, ok := titleToPath[link]; ok {
					target = p
				}
				if target == "" || target == n.Path {
					continue
				}
				e := edge{n.Path, target}
				if !seen[e] {
					seen[e] = true
					links = append(links, GraphLink{Source: n.Path, Target: target})
				}
			}
		}

		c.JSON(http.StatusOK, GraphData{Nodes: nodes, Links: links})
	}
}

func topFolder(folder string) string {
	if folder == "root" || folder == "." {
		return "root"
	}
	parts := filepath.SplitList(folder)
	if len(parts) > 0 {
		return parts[0]
	}
	return folder
}
