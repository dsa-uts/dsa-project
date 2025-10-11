package fileutil

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Remove all metadata files and directories like __MACOSX, .DS_Store, etc.
// under the given directory.
func RemoveMetaData(destDir string) error {
	metaPatterns := []string{
		"__MACOSX",
		".DS_Store",
		"Thumbs.db",
		"._.DS_Store",
		"._*",
		".Spotlight-V100",
		".Trashes",
		".fseventsd",
		".TemporaryItems",
		".VolumeIcon.icns",
		"desktop.ini",
	}

	var errs []error

	// Walk through all files and directories
	err := filepath.Walk(destDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			errs = append(errs, fmt.Errorf("access error at %s: %w", path, err))
			return nil
		}

		// Skip the root directory itself
		if path == destDir {
			return nil
		}

		baseName := filepath.Base(path)

		// Check if this file/dir matches any meta pttern
		shouldRemove := false
		for _, pattern := range metaPatterns {
			if pattern == baseName {
				shouldRemove = true
				break
			}
			// Handle wildcard patterns like "._*"
			if strings.Contains(pattern, "*") {
				matched, _ := filepath.Match(pattern, baseName)
				if matched {
					shouldRemove = true
					break
				}
			}
		}

		if shouldRemove {
			// Remove file or directory
			var removeErr error
			if info.IsDir() {
				removeErr = os.RemoveAll(path)
			} else {
				removeErr = os.Remove(path)
			}

			if removeErr != nil {
				errs = append(errs, fmt.Errorf("failed to remove %s: %w", path, removeErr))
			}

			// If it's a directory and removed it, skip its contents
			if info.IsDir() && removeErr == nil {
				return filepath.SkipDir
			}
		}

		return nil
	})

	if err != nil {
		errs = append(errs, fmt.Errorf("walk error: %w", err))
	}

	// Combine all errors if any occured
	if len(errs) > 0 {
		errMsg := "encountered errors while removing metadata:"
		for _, e := range errs {
			errMsg += "\n - " + e.Error()
		}
		return errors.New(errMsg)
	}

	return nil
}
