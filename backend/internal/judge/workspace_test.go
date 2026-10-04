package judge

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestPlaceFile(t *testing.T) {
	tests := []struct {
		name       string
		existing   string
		target     string
		replace    bool
		executable bool
		wantErr    bool
	}{
		{name: "nested file", target: "a/b/main", executable: true},
		{name: "existing file is preserved", existing: "main", target: "main", wantErr: true},
		{name: "replace file", existing: "main", target: "main", replace: true},
		{name: "file blocks parent", existing: "a", target: "a/main", wantErr: true},
		{name: "replace blocking file with directory", existing: "a", target: "a/main", replace: true},
		{name: "replace directory with file", existing: "a/child", target: "a", replace: true},
		{name: "reject parent traversal", target: "../outside", replace: true, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			directory := t.TempDir()
			if tt.existing != "" {
				path := filepath.Join(directory, tt.existing)
				if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte("original"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			// Preserve the test user's UID/GID; production assigns the submission UID.
			options := fileOptions{uid: -1, replace: tt.replace, executable: tt.executable}
			err := placeFile(context.Background(), directory, tt.target, []byte("placed"), options)
			if (err != nil) != tt.wantErr {
				t.Fatalf("placeFile error = %v, want error %v", err, tt.wantErr)
			}
			if tt.wantErr {
				if tt.existing != "" {
					data, err := os.ReadFile(filepath.Join(directory, tt.existing))
					if err != nil || string(data) != "original" {
						t.Fatalf("existing file = %q, %v; want original", data, err)
					}
				}
				return
			}
			path := filepath.Join(directory, tt.target)
			data, err := os.ReadFile(path)
			if err != nil || string(data) != "placed" {
				t.Fatalf("placed file = %q, %v; want placed", data, err)
			}
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			wantMode := os.FileMode(0644)
			if tt.executable {
				wantMode = 0755
			}
			if info.Mode().Perm() != wantMode {
				t.Errorf("mode = %o, want %o", info.Mode().Perm(), wantMode)
			}
		})
	}
}

func TestPlaceFileReplacesSymlinkWithoutTouchingTarget(t *testing.T) {
	directory, outside := t.TempDir(), t.TempDir()
	target := filepath.Join(outside, "keep")
	if err := os.WriteFile(target, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(directory, "link")); err != nil {
		t.Fatal(err)
	}
	if err := placeFile(context.Background(), directory, "link/keep", []byte("placed"), fileOptions{uid: -1, replace: true}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "original" {
		t.Fatalf("outside file = %q, %v; want original", data, err)
	}
	data, err = os.ReadFile(filepath.Join(directory, "link", "keep"))
	if err != nil || string(data) != "placed" {
		t.Fatalf("placed file = %q, %v; want placed", data, err)
	}
}
