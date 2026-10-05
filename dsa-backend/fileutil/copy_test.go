package fileutil

import (
	"archive/zip"
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/afero"
)

func TestWriteToRoot(t *testing.T) {
	parent := t.TempDir()
	dir := filepath.Join(parent, "upload")
	outside := filepath.Join(parent, "upload-other")
	for _, path := range []string{dir, outside} {
		if err := os.Mkdir(path, 0755); err != nil {
			t.Fatal(err)
		}
	}
	victim := filepath.Join(outside, "file.txt")
	if err := os.WriteFile(victim, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()

	for _, tt := range []struct {
		name    string
		path    string
		wantErr bool
	}{
		{"nested file", "src/main.c", false},
		{"replace file", "src/main.c", false},
		{"shared prefix sibling", "../upload-other/file.txt", true},
		{"outside directory creation", "../upload-other/new/file.txt", true},
		{"absolute path", victim, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			err := WriteToRoot(root, tt.path, strings.NewReader(tt.name), 0644)
			if (err != nil) != tt.wantErr {
				t.Fatalf("WriteToRoot(%q) error = %v, wantErr %v", tt.path, err, tt.wantErr)
			}
			if !tt.wantErr {
				data, err := root.ReadFile(tt.path)
				if err != nil || string(data) != tt.name {
					t.Fatalf("ReadFile(%q) = %q, %v; want %q", tt.path, data, err, tt.name)
				}
			}
		})
	}
	data, err := os.ReadFile(victim)
	if err != nil || string(data) != "original" {
		t.Fatalf("outside file = %q, %v; want unchanged content", data, err)
	}
	if _, err := os.Stat(filepath.Join(outside, "new")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("outside directory Stat error = %v, want not exist", err)
	}
}

func TestCopyToRootFromZip(t *testing.T) {
	var archive bytes.Buffer
	w := zip.NewWriter(&archive)
	for _, entry := range []struct {
		name string
		mode os.FileMode
		data string
	}{
		{"project/src/main.c", 0644, "int main(void) { return 0; }"},
		{"project/run.sh", 0755, "#!/bin/sh\n"},
		{"project/link", os.ModeSymlink | 0777, "../../outside"},
		{"project/empty/", os.ModeDir | 0755, ""},
	} {
		header := &zip.FileHeader{Name: entry.name}
		header.SetMode(entry.mode)
		file, err := w.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte(entry.data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	mem := afero.NewMemMapFs()
	if err := SafeExtractZip(mem, bytes.NewReader(archive.Bytes()), int64(archive.Len()), "/"); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := CopyToRoot(mem, "/project", root); err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]string{
		"src/main.c": "int main(void) { return 0; }",
		"run.sh":     "#!/bin/sh\n",
		"link":       "../../outside",
	} {
		data, err := root.ReadFile(name)
		if err != nil || string(data) != want {
			t.Errorf("ReadFile(%q) = %q, %v; want %q", name, data, err, want)
		}
	}
	info, err := root.Lstat("link")
	if err != nil {
		t.Fatal(err)
	}
	if !info.Mode().IsRegular() {
		t.Errorf("ZIP symlink mode = %v, want regular file", info.Mode())
	}
	info, err = root.Stat("empty")
	if err != nil {
		t.Fatal(err)
	}
	if !info.IsDir() {
		t.Error("empty ZIP directory was not preserved")
	}
	if err := CopyToRoot(mem, "/project", root); !errors.Is(err, os.ErrExist) {
		t.Errorf("copy to nonempty root error = %v, want os.ErrExist", err)
	}
}
