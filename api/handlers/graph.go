package handlers

import (
	"net/http"
	"path/filepath"
	"strings"

	"obsidian-dashboard/parser"

	"github.com/gin-gonic/gin"
)

type GraphNode struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Folder    string `json:"folder"`
	Group     string `json:"group"`
	LinkCount int    `json:"link_count"`
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
		filter := c.Query("filter") // "core" (exclude graphify dumps) or "all" (default)

		// Build title → path index for link resolution
		titleToPath := make(map[string]string)
		for _, n := range notes {
			titleToPath[n.Title] = n.Path
			base := filepath.Base(n.Path)
			if len(base) > 3 && strings.HasSuffix(base, ".md") {
				titleToPath[base[:len(base)-3]] = n.Path
			}
		}

		// Pre-calculate link degree
		linkCountMap := make(map[string]int)

		type edge struct{ s, t string }
		seen := make(map[edge]bool)
		links := []GraphLink{}

		for _, n := range notes {
			if filter == "core" && strings.HasPrefix(n.Folder, "graphify-out") {
				continue
			}
			for _, link := range n.Links {
				target := ""
				if p, ok := titleToPath[link]; ok {
					target = p
				}
				if target == "" || target == n.Path {
					continue
				}
				if filter == "core" && strings.HasPrefix(target, "graphify-out") {
					continue
				}
				e := edge{n.Path, target}
				if !seen[e] {
					seen[e] = true
					links = append(links, GraphLink{Source: n.Path, Target: target})
					linkCountMap[n.Path]++
					linkCountMap[target]++
				}
			}
		}

		nodes := make([]GraphNode, 0, len(notes))
		for _, n := range notes {
			if filter == "core" && strings.HasPrefix(n.Folder, "graphify-out") {
				continue
			}
			nodes = append(nodes, GraphNode{
				ID:        n.Path,
				Title:     n.Title,
				Folder:    n.Folder,
				Group:     topFolder(n.Folder),
				LinkCount: linkCountMap[n.Path],
			})
		}

		c.JSON(http.StatusOK, GraphData{Nodes: nodes, Links: links})
	}
}

func topFolder(folder string) string {
	if folder == "root" || folder == "." {
		return "root"
	}
	parts := strings.Split(filepath.ToSlash(folder), "/")
	if len(parts) > 0 && parts[0] != "" {
		return parts[0]
	}
	return folder
}
