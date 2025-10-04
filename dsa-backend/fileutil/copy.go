package fileutil

import (
	"io"
	"os"
	"path/filepath"
)

// CopyContents recursively copies a directory tree
func CopyContents(src string, dst string) error {
	src = filepath.Clean(src)
	dst = filepath.Clean(dst)

	_, err := os.Stat(src)
	if err != nil {
		return err
	}

	_, err = os.Stat(dst)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		relPath, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		targetPath := filepath.Join(dst, relPath)
		if info.IsDir() {
			// In the case of a directory, create it
			return os.MkdirAll(targetPath, info.Mode())
		}
		// In the case of a file, copy the contents
		srcFile, err := os.Open(path)
		if err != nil {
			return err
		}
		defer srcFile.Close()
		dstFile, err := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode())
		if err != nil {
			return err
		}
		defer dstFile.Close()
		_, err = io.Copy(dstFile, srcFile)
		return err
	})
}
