package fileutil

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// TODO: Discuss file size limits
// TODO: Make this configuration be configurable via env file, or admin API.
const (
	// Maximum uncompressed size for uploaded files (10MB)
	MaxUncompressedSize = 10 * 1024 * 1024
	// Maximum size for a single uploaded file (5MB)
	MaxFileSize = 5 * 1024 * 1024
	// Maximum number of uploaded files
	MaxFiles = 500
)

// Extracts zip file with validation of size constraints.
// We check those constraints before/during extracting.
//
//  1. Check the number of files is above `maxFiles`.
//  2. Check the total size of all uncompressed files is below `maxUncompressedSize`.
//  3. Check the individual file sizes are below `maxFileSize`.
//
// Also, this function takes care of path-traversal attacks by sanitizing file paths.
//
// When all checks pass, extract the zip file to the specified destination directory.
// Otherwise, remove the destination directory and return an error.
func SafeExtractZip(zipPath, destDir string) error {
	// Open the zip file.
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("failed to open zip file: %w", err)
	}
	defer reader.Close()

	// Check the number of files in the zip file.
	if len(reader.File) > MaxFiles {
		return fmt.Errorf("zip file contains too many files (max: %d)", MaxFiles)
	}

	// Check the total expected size of uncompressed files, before extracting.
	var totalUncompressed uint64
	for _, file := range reader.File {
		totalUncompressed += file.UncompressedSize64
		if totalUncompressed > MaxUncompressedSize {
			return fmt.Errorf("uncompressed size too large (max: %d MB)", MaxUncompressedSize/(1024*1024))
		}
	}

	// Make destination directory.
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}

	// Extract files.
	for _, file := range reader.File {
		if err := extractFile(file, destDir); err != nil {
			// When error occurs, remove destination directory
			os.RemoveAll(destDir)
			return err
		}
	}

	return nil
}

func extractFile(file *zip.File, destDir string) error {
	// Sanitize file name to prevent path traversal attacks.
	cleanPath := filepath.Clean(file.Name)
	cleanPath = filepath.Join("/", cleanPath) // resolve all "../" to prevent path traversal
	if strings.Contains(cleanPath, "..") {
		return fmt.Errorf("invalid file path: %s", file.Name)
	}

	targetPath := filepath.Join(destDir, cleanPath)

	// Check if the target path is within the destination directory.
	if !strings.HasPrefix(filepath.Clean(targetPath), filepath.Clean(destDir)) {
		return fmt.Errorf("file path outside of destination directory: %s", file.Name)
	}

	// Check if this individual file exceeds the size limit.
	if file.UncompressedSize64 > MaxFileSize {
		return fmt.Errorf("file %s too large (max %d MB)", file.Name, MaxFileSize/(1024*1024))
	}

	// In the case of "file" is a directory
	if file.FileInfo().IsDir() {
		// make directory
		return os.MkdirAll(targetPath, file.Mode())
	}

	// In the case of "file" is a regular file
	// Make parent directory
	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		return fmt.Errorf("failed to create directory for %s: %w", targetPath, err)
	}

	// Open file
	rc, err := file.Open()
	if err != nil {
		return fmt.Errorf("failed to open file %s in zip: %w", file.Name, err)
	}
	defer rc.Close()

	// Create output file
	outFile, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.Mode())
	if err != nil {
		return fmt.Errorf("failed to create output file %s: %w", targetPath, err)
	}
	defer outFile.Close()

	// Copy it with size limit
	limitedReader := &io.LimitedReader{
		R: rc,
		N: int64(MaxFileSize),
	}

	written, err := io.Copy(outFile, limitedReader)
	if err != nil {
		return fmt.Errorf("failed to extract file: %w", err)
	}

	// Check if the entire file was copied
	if uint64(written) != file.UncompressedSize64 {
		return fmt.Errorf("file size mismatch for %s", file.Name)
	}

	return nil
}
