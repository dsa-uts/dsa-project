package fileutil

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// RemoveObjectFiles removes object files (e.g., .o, .obj) from the specified directory and its subdirectories.
func RemoveObjectFiles(destDir string) error {
	objectExtensions := []string{
		".o",     // Unix/Linux object file
		".obj",   // Windows object file
		".a",     // Static library (archive)
		".lib",   // Windows static library
		".so",    // Shared object (Linux/Unix)
		".dll",   // Windows dynamic library
		".dylib", // macOS dynamic library
		".pdb",   // Program database (Windows debug)
		".exp",   // Export file (Windows)
		".ilk",   // Incremental linking file (Windows)
		".la",    // Libtool archive
		".lo",    // Libtool object
		".pyc",   // Python compiled bytecode
		".pyo",   // Python optimized bytecode
		".class", // Java class file
		".elc",   // Emacs Lisp compiled
		".beam",  // Erlang compiled
		".ko",    // Linux kernel object
		".mod",   // Kernel module file
		".rlib",  // Rust library
		".rmeta", // Rust metadata
		".bc",    // LLVM bitcode
	}

	var errs []error
	removedCount := 0

	err := filepath.Walk(destDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// If there is an error accessing the path, record it and continue.
			errs = append(errs, fmt.Errorf("access error at %s: %w", path, err))
			return nil
		}

		// Skip directory
		if info.IsDir() {
			return nil
		}

		// Check the file extension
		ext := strings.ToLower(filepath.Ext(path))
		shouldRemove := false

		for _, objExt := range objectExtensions {
			if ext == objExt {
				shouldRemove = true
				break
			}
		}

		if shouldRemove {
			// Remove the file
			if removeErr := os.Remove(path); removeErr != nil {
				errs = append(errs, fmt.Errorf("failed to remove %s: %w", path, removeErr))
			} else {
				removedCount++
			}
		}

		return nil
	})

	if err != nil {
		errs = append(errs, fmt.Errorf("walk error: %w", err))
	}

	if len(errs) > 0 {
		errMsg := fmt.Sprintf("removed %d object files, but encountered %d errors:", removedCount, len(errs))
		for _, e := range errs {
			errMsg += "\n - " + e.Error()
		}
		return errors.New(errMsg)
	}

	return nil
}
