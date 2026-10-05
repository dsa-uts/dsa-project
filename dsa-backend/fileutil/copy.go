package fileutil

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/spf13/afero"
)

// CopyToRoot copies the contents of src into an empty destination root.
// src must be an absolute path in srcFs.
func CopyToRoot(srcFs afero.Fs, src string, dst *os.Root) error {
	src = filepath.Clean(src)

	if !filepath.IsAbs(src) {
		return fmt.Errorf("source path must be absolute: %s", src)
	}

	// Check if src exists
	_, err := srcFs.Stat(src)
	if err != nil {
		return err
	}

	entries, err := fs.ReadDir(dst.FS(), ".")
	if err != nil {
		return err
	}
	if len(entries) != 0 {
		return os.ErrExist
	}

	return afero.Walk(srcFs, src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		relPath, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if info.IsDir() {
			return dst.MkdirAll(relPath, info.Mode().Perm())
		}
		// In the case of a file, copy the contents
		srcFile, err := srcFs.Open(path)
		if err != nil {
			return err
		}
		defer srcFile.Close()
		return WriteToRoot(dst, relPath, srcFile, info.Mode().Perm())
	})
}

// WriteToRoot writes src to a root-relative name, creating parent directories
// and replacing any existing file. Paths escaping dst are rejected by os.Root.
func WriteToRoot(dst *os.Root, name string, src io.Reader, perm os.FileMode) error {
	if err := dst.MkdirAll(filepath.Dir(name), 0755); err != nil {
		return err
	}
	file, err := dst.OpenFile(name, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, perm)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(file, src)
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}
