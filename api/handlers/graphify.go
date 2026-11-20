package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"obsidian-dashboard/parser"

	"github.com/gin-gonic/gin"
)

type Community struct {
	ID    int    `json:"id"`
	Label string `json:"label"`
}

type GraphifyResponse struct {
	Available   bool                 `json:"available"`
	Communities map[string]Community `json:"communities"`
}

type graphifyFile struct {
	Nodes []struct {
		SourceFile    string `json:"source_file"`
		Community     *int   `json:"community"`
		CommunityName string `json:"community_name"`
	} `json:"nodes"`
}

func GetGraphify(v *parser.Vault) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, LoadGraphify(v.VaultPath))
	}
}

// LoadGraphify maps each vault note to the graphify community most of its extracted concepts belong to.
func LoadGraphify(vaultPath string) GraphifyResponse {
	resp := GraphifyResponse{Communities: map[string]Community{}}
	data, err := os.ReadFile(filepath.Join(vaultPath, "graphify-out", "graph.json"))
	if err != nil {
		return resp
	}
	var g graphifyFile
	if json.Unmarshal(data, &g) != nil {
		return resp
	}

	votes := map[string]map[int]int{}
	names := map[int]string{}
	for _, n := range g.Nodes {
		if n.Community == nil || !strings.HasSuffix(n.SourceFile, ".md") {
			continue
		}
		p := filepath.ToSlash(n.SourceFile)
		if votes[p] == nil {
			votes[p] = map[int]int{}
		}
		votes[p][*n.Community]++
		if n.CommunityName != "" {
			names[*n.Community] = n.CommunityName
		}
	}
	for p, counts := range votes {
		best, bestN := 0, -1
		for id, n := range counts {
			if n > bestN || (n == bestN && id < best) {
				best, bestN = id, n
			}
		}
		label := names[best]
		if label == "" {
			label = fmt.Sprintf("Community %d", best)
		}
		resp.Communities[p] = Community{ID: best, Label: label}
	}
	resp.Available = len(resp.Communities) > 0
	return resp
}
