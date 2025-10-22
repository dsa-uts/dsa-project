package fileutil

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/spf13/afero"
)

// Recursively copies contents between two Afero filesystems
// src and dst must be absolute paths, beginning with "/"
func CopyContentsBetweenAferoFs(srcFs afero.Fs, src string, dstFs afero.Fs, dst string) error {
	src = filepath.Clean(src)
	dst = filepath.Clean(dst)

	if !filepath.IsAbs(src) || !filepath.IsAbs(dst) {
		return fmt.Errorf("path must be absolute: src=%s, dst=%s", src, dst)
	}

	// Check if src exists
	_, err := srcFs.Stat(src)
	if err != nil {
		return err
	}

	// Check if there are any contents in dst
	if isEmpty, err := afero.IsEmpty(dstFs, dst); err == nil && !isEmpty {
		// There is a file or directory already existing at dst and it is not empty
		return os.ErrExist
	} else if err != nil && !os.IsNotExist(err) {
		// Some other error except "not exist" (which is fine)
		return err
	}

	// Make dst directory
	// If dst does exist, MkdirAll does nothing and returns nil
	err = dstFs.MkdirAll(dst, 0755)
	if err != nil {
		return err
	}

	return afero.Walk(srcFs, src, func(path string, info os.FileInfo, err error) error {
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
			return dstFs.MkdirAll(targetPath, info.Mode())
		}
		// In the case of a file, copy the contents
		srcFile, err := srcFs.Open(path)
		if err != nil {
			return err
		}
		defer srcFile.Close()
		dstFile, err := dstFs.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode())
		if err != nil {
			return err
		}
		defer dstFile.Close()
		_, err = io.Copy(dstFile, srcFile)
		return err
	})
}
