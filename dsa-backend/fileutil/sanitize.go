package fileutil

import (
	"path/filepath"
	"strings"
)

func SanitizeRelPath(path string) string {
	cleanPath := filepath.Join("/", filepath.Clean(path))
	return strings.TrimPrefix(cleanPath, "/")
}

// normalize path separators to "/"
// For example, convert "src\main.c" to "src/main.c"
func NormalizePath(p string) string {
	// Convert "\" to "/"
	p = strings.ReplaceAll(p, "\\", "/")
	// Remove redundant "/" characters
	p = filepath.Clean(p)
	return p
}

func CheckPathSafety(path string) bool {
	if strings.Contains(path, "..") || strings.Contains(path, ".") || strings.Contains(path, "\\") || strings.Contains(path, "//") {
		return false
	}
	return true
}
