package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"obsidian-dashboard/handlers"
	"obsidian-dashboard/parser"
	"obsidian-dashboard/server"

	"github.com/fsnotify/fsnotify"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "hash-password" {
		line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		pw := strings.TrimRight(line, "\r\n")
		if len(pw) < 12 {
			log.Fatal("password must be at least 12 characters")
		}
		h, err := server.HashPassword(pw)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(string(h))
		return
	}

	home, _ := os.UserHomeDir()
	vaultPath := env("VAULT_PATH", filepath.Join(home, "Documents", "Obsidian Vault"))
	addr := env("ADDR", "127.0.0.1:8080")
	internalAddr := env("INTERNAL_ADDR", "127.0.0.1:8081")
	nextURL, err := url.Parse(env("NEXT_URL", "http://127.0.0.1:3000"))
	if err != nil {
		log.Fatalf("NEXT_URL: %v", err)
	}

	hashFile := os.Getenv("DASH_PASS_HASH_FILE")
	hash, err := os.ReadFile(hashFile)
	if hashFile == "" || err != nil || len(bytes.TrimSpace(hash)) == 0 {
		log.Fatalf("auth: DASH_PASS_HASH_FILE must point to a bcrypt hash (create one with `obsidian-dashboard-api hash-password`): %v", err)
	}
	auth := server.NewAuth(env("DASH_USER", "faris"), bytes.TrimSpace(hash))

	log.Printf("Loading vault: %s", vaultPath)
	vault := parser.NewVault(vaultPath)
	if err := vault.Load(); err != nil {
		log.Fatalf("Failed to load vault: %v", err)
	}
	log.Printf("Loaded %d notes", len(vault.Notes))

	hub := handlers.NewHub()
	go watchVault(vaultPath, vault, hub)

	api := server.APIEngine(vault, hub)
	go func() {
		log.Printf("Internal API (no auth, loopback only) on %s", internalAddr)
		log.Fatal(http.ListenAndServe(internalAddr, api))
	}()
	log.Printf("Public entry (auth) on %s → Next.js %s", addr, nextURL)
	log.Fatal(http.ListenAndServe(addr, server.Public(api, nextURL, auth)))
}

func watchVault(vaultPath string, vault *parser.Vault, hub *handlers.Hub) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("fsnotify error: %v", err)
		return
	}
	defer watcher.Close()

	addTree := func(root string) {
		_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if info.IsDir() {
				if strings.HasPrefix(info.Name(), ".") {
					return filepath.SkipDir
				}
				_ = watcher.Add(path)
			}
			return nil
		})
	}
	addTree(vaultPath)

	debounce := make(map[string]*time.Timer)
	reload := func(path string) {
		if t, ok := debounce[path]; ok {
			t.Stop()
		}
		debounce[path] = time.AfterFunc(300*time.Millisecond, func() {
			vault.ReloadFile(path)
			msg, _ := json.Marshal(map[string]string{"type": "reload", "path": path})
			hub.Broadcast(msg)
			log.Printf("Reloaded: %s", path)
		})
	}

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			// New folders (e.g. Research/<topic>/ created by agents) must be watched too.
			if event.Has(fsnotify.Create) {
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() && !strings.HasPrefix(info.Name(), ".") {
					addTree(event.Name)
					_ = filepath.Walk(event.Name, func(p string, fi os.FileInfo, err error) error {
						if err == nil && !fi.IsDir() && strings.HasSuffix(p, ".md") {
							reload(p)
						}
						return nil
					})
					continue
				}
			}
			if strings.HasSuffix(event.Name, ".md") {
				reload(event.Name)
			}
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Printf("watcher error: %v", err)
		}
	}
}
