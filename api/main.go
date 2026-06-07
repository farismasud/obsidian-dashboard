package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"obsidian-dashboard/handlers"
	"obsidian-dashboard/parser"

	"github.com/fsnotify/fsnotify"
	"github.com/gin-gonic/gin"
)

func main() {
	home, _ := os.UserHomeDir()
	vaultPath := filepath.Join(home, "Documents", "Obsidian Vault")

	if v := os.Getenv("VAULT_PATH"); v != "" {
		vaultPath = v
	}

	log.Printf("Loading vault: %s", vaultPath)
	vault := parser.NewVault(vaultPath)
	if err := vault.Load(); err != nil {
		log.Fatalf("Failed to load vault: %v", err)
	}
	log.Printf("Loaded %d notes", len(vault.Notes))

	hub := handlers.NewHub()

	// Watch vault for changes
	go watchVault(vaultPath, vault, hub)

	r := gin.Default()

	// CORS for Next.js dev
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "http://localhost:3000")
		c.Header("Access-Control-Allow-Methods", "GET, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	api := r.Group("/api")
	{
		api.GET("/notes", handlers.GetNotes(vault))
		api.GET("/note/*path", handlers.GetNote(vault))
		api.GET("/projects", handlers.GetProjects(vault))
		api.GET("/graph", handlers.GetGraph(vault))
		api.GET("/search", handlers.Search(vault))
		api.GET("/stats", handlers.GetStats(vault))
	}

	r.GET("/ws", hub.Handler())

	log.Println("API running on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}

func watchVault(vaultPath string, vault *parser.Vault, hub *handlers.Hub) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("fsnotify error: %v", err)
		return
	}
	defer watcher.Close()

	// Watch vault directory recursively
	_ = filepath.Walk(vaultPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() && !strings.HasPrefix(info.Name(), ".") {
			_ = watcher.Add(path)
		}
		return nil
	})

	debounce := make(map[string]*time.Timer)

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			if !strings.HasSuffix(event.Name, ".md") {
				continue
			}

			// Debounce 300ms per file
			if t, exists := debounce[event.Name]; exists {
				t.Stop()
			}
			path := event.Name
			debounce[path] = time.AfterFunc(300*time.Millisecond, func() {
				vault.ReloadFile(path)
				msg, _ := json.Marshal(map[string]string{
					"type": "reload",
					"path": path,
				})
				hub.Broadcast(msg)
				log.Printf("Reloaded: %s", path)
			})

		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Printf("watcher error: %v", err)
		}
	}
}
