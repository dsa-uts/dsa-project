package fileutil

import (
	"fmt"
	"path/filepath"
	"strings"
)

// Clean and sanitize a file path to prevent path traversal attacks.
// It ensures the resulting path is within the specified base directory.
func GenerateSafePath(baseAbsDir, userPath string) (string, error) {
	// Check if baseAbsDir is absolute
	if !filepath.IsAbs(baseAbsDir) {
		return "", fmt.Errorf("base directory must be an absolute path: %s", baseAbsDir)
	}

	// Check if baseAbsDir includes any "..", ".", "\", or "//" components
	if !CheckPathSafety(baseAbsDir) {
		return "", fmt.Errorf("invalid base directory path: %s", baseAbsDir)
	}

	absPath, err := filepath.Abs(filepath.Join(baseAbsDir, userPath))
	if err != nil {
		return "", err
	}

	// Check if absPath includes any "..", ".", "\", or "//" components
	cleanPath := filepath.Clean(userPath)
	if !CheckPathSafety(cleanPath) {
		return "", fmt.Errorf("invalid file path: %s", userPath)
	}

	// Ensure the resulting path is within the base directory
	if !strings.HasPrefix(absPath, baseAbsDir) {
		return "", fmt.Errorf("invalid file path: %s", userPath)
	}

	return absPath, nil
}

func SanitizeRelPath(path string) string {
	cleanPath := filepath.Join("/", filepath.Clean(path))
	return strings.TrimPrefix(cleanPath, "/")
}

func CheckPathSafety(path string) bool {
	if strings.Contains(path, "..") || strings.Contains(path, ".") || strings.Contains(path, "\\") || strings.Contains(path, "//") {
		return false
	}
	return true
}
