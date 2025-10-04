package util

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
)

type FileData struct {
	Name         string `json:"filename"`
	Data         string `json:"data"`        // base64 encoded data, compressed by gzip
	Compression  string `json:"compression"` // e.g., "gzip"
	OriginalSize int64  `json:"original_size"`
}

// Reads all files in the given directory (non-recursively) and returns their data as a slice of FileData.
// If the path is not a directory, returns an error.
//
// Each file's content is read, compressed using gzip, and then encoded in base64.
func FetchAllFilesInDirectory(dirPath string) ([]FileData, error) {
	var fileDataList []FileData

	// Check if dirPath is a directory
	stat, err := os.Stat(dirPath)
	if err != nil {
		return nil, err
	}
	if !stat.IsDir() {
		return nil, fmt.Errorf("provided path is not a directory: %s", dirPath)
	}

	// Walk through the directory
	err = filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		relPath, err := filepath.Rel(dirPath, path)
		if err != nil {
			return err
		}
		if info.IsDir() {
			// Skip directories
			return nil
		}

		// read file
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}

		// compress by gzip
		var buf bytes.Buffer
		gzipWriter := gzip.NewWriter(&buf)
		gzipWriter.Write(data)
		gzipWriter.Close()

		data = buf.Bytes()

		fileData := FileData{
			Name:         relPath,
			Data:         base64.StdEncoding.EncodeToString(data),
			Compression:  "gzip",
			OriginalSize: info.Size(),
		}
		fileDataList = append(fileDataList, fileData)
		return nil
	})

	if err != nil {
		return nil, err
	}

	return fileDataList, nil
}

// FetchFile reads a single file from the given path, compresses its content using gzip,
// and returns the data as a FileData struct.
// If the path is not a file, returns an error.
// The file content is read, compressed using gzip, and then encoded in base64.
func FetchFile(filePath string) (*FileData, error) {
	// Check if filePath is a file
	stat, err := os.Stat(filePath)
	if err != nil {
		return nil, err
	}
	if stat.IsDir() {
		return nil, fmt.Errorf("provided path is a directory, not a file: %s", filePath)
	}

	// read file
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	// compress by gzip
	var buf bytes.Buffer
	gzipWriter := gzip.NewWriter(&buf)
	gzipWriter.Write(data)
	gzipWriter.Close()

	data = buf.Bytes()

	fileData := &FileData{
		Name:         filepath.Base(filePath),
		Data:         base64.StdEncoding.EncodeToString(data),
		Compression:  "gzip",
		OriginalSize: stat.Size(),
	}

	return fileData, nil
}
