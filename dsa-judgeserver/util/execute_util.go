package util

import (
	"archive/tar"
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Creates a tar archive from the given source path.
func CreateTarArchive(srcPath string) (io.Reader, error) {
	// Clean the source path
	srcPath = filepath.Clean(srcPath)

	// Get file info
	info, err := os.Stat(srcPath)
	if err != nil {
		return nil, fmt.Errorf("failed to get source path: %w", err)
	}

	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	defer tw.Close()

	// If it's a file, add just the file
	if !info.IsDir() {
		if err := addFileToTar(tw, srcPath, filepath.Base(srcPath)); err != nil {
			return nil, err
		}
	} else {
		// If it's a directory, walk through all files
		err = filepath.Walk(srcPath, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}

			// Create relative path for tar header
			relPath, err := filepath.Rel(srcPath, path)
			if err != nil {
				return fmt.Errorf("failed to get relative path: %w", err)
			}

			// Skip if it's the root directory itself
			if relPath == "." {
				return nil
			}

			// Convert to Unix-style path for tar
			tarPath := filepath.ToSlash(relPath)

			// Add to tar archive
			if info.IsDir() {
				return addDirToTar(tw, tarPath)
			}
			return addFileToTar(tw, path, tarPath)
		})

		if err != nil {
			return nil, fmt.Errorf("failed to walk directory: %w", err)
		}
	}

	return &buf, nil
}

// Adds a file to the tar archive
func addFileToTar(tw *tar.Writer, filePath, tarPath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open file %s: %w", filePath, err)
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("failed to stat file %s: %w", filePath, err)
	}

	header, err := tar.FileInfoHeader(info, "")
	if err != nil {
		return fmt.Errorf("failed to create tar header for file %s: %w", filePath, err)
	}

	// Set the name in the archive
	header.Name = tarPath

	// Write header
	if err := tw.WriteHeader(header); err != nil {
		return fmt.Errorf("failed to write tar header for file %s: %w", filePath, err)
	}

	// Copy file content
	if _, err := io.Copy(tw, file); err != nil {
		return fmt.Errorf("failed to copy file %s content to tar: %w", filePath, err)
	}

	return nil
}

// adds a directory to the tar archive
func addDirToTar(tw *tar.Writer, dirPath string) error {
	header := &tar.Header{
		Name:     dirPath + "/",
		Mode:     0755,
		Typeflag: tar.TypeDir,
	}

	if err := tw.WriteHeader(header); err != nil {
		return fmt.Errorf("failed to write directory header: %w", err)
	}

	return nil
}
