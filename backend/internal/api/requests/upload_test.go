package requests

import (
	"bytes"
	"fmt"
	"mime/multipart"
	"net/textproto"
	"strings"
	"testing"
)

type uploadPart struct{ name, body string }

func upload(parts ...uploadPart) *multipart.Reader {
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	for _, p := range parts {
		h := textproto.MIMEHeader{"Content-Disposition": {fmt.Sprintf(`form-data; name=%q`, p.name)}, "Content-Type": {"application/octet-stream"}}
		if p.name == "metadata" {
			h.Set("Content-Type", "application/json")
		}
		part, _ := w.CreatePart(h)
		_, _ = part.Write([]byte(p.body))
	}
	_ = w.Close()
	return multipart.NewReader(&b, w.Boundary())
}

func TestUpload(t *testing.T) {
	meta := uploadPart{"metadata", `{"files":[{"part":"a","path":"answer/./main.c"},{"part":"b","path":"Makefile"}]}`}
	files, hash, err := readUpload(upload(meta, uploadPart{"a", "\x00\xffsource"}, uploadPart{"b", ""}))
	if err != nil || len(files) != 2 || files[0].Path != "Makefile" || files[1].Path != "answer/main.c" || string(files[1].Content) != "\x00\xffsource" {
		t.Fatalf("files=%+v err=%v", files, err)
	}
	_, reordered, err := readUpload(upload(uploadPart{"b", ""}, uploadPart{"a", "\x00\xffsource"}, uploadPart{"metadata", `{"files":[{"part":"b","path":"Makefile"},{"part":"a","path":"answer//main.c"}]}`}))
	if err != nil || reordered != hash {
		t.Fatalf("identity depends on part/path ordering: %s %s %v", hash, reordered, err)
	}
	_, changed, err := readUpload(upload(meta, uploadPart{"a", "different"}, uploadPart{"b", ""}))
	if err != nil || changed == hash {
		t.Fatal("changed bytes did not change identity")
	}
}

func TestUploadRejectsInvalidParts(t *testing.T) {
	meta := uploadPart{"metadata", `{"files":[{"part":"a","path":"main.c"},{"part":"b","path":"Makefile"}]}`}
	for _, tc := range []struct {
		name  string
		parts []uploadPart
	}{
		{"missing", []uploadPart{meta, {"a", "x"}}},
		{"extra", []uploadPart{meta, {"a", "x"}, {"b", ""}, {"c", ""}}},
		{"duplicate part", []uploadPart{meta, {"a", "x"}, {"a", "x"}, {"b", ""}}},
		{"duplicate metadata", []uploadPart{meta, meta, {"a", "x"}, {"b", ""}}},
		{"duplicate path", []uploadPart{{"metadata", `{"files":[{"part":"a","path":"a/./b"},{"part":"b","path":"a/b"}]}`}, {"a", ""}, {"b", ""}}},
		{"duplicate normalized path", []uploadPart{{"metadata", `{"files":[{"part":"a","path":"../x"},{"part":"b","path":"/x"}]}`}, {"a", ""}, {"b", ""}}},
		{"parent collision", []uploadPart{{"metadata", `{"files":[{"part":"a","path":"answer"},{"part":"b","path":"answer/main.c"}]}`}, {"a", ""}, {"b", ""}}},
		{"normalized parent collision", []uploadPart{{"metadata", `{"files":[{"part":"a","path":"answer"},{"part":"b","path":"answer\\main.c"}]}`}, {"a", ""}, {"b", ""}}},
		{"repeated reference", []uploadPart{{"metadata", `{"files":[{"part":"a","path":"a"},{"part":"a","path":"b"}]}`}, {"a", ""}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := readUpload(upload(tc.parts...)); err == nil {
				t.Fatal("accepted invalid upload")
			}
		})
	}
}

func TestUploadFileSizeLimit(t *testing.T) {
	meta := uploadPart{"metadata", `{"files":[{"part":"a","path":"main.c"},{"part":"b","path":"Makefile"}]}`}
	for _, size := range []int{maxFileBytes, maxFileBytes + 1} {
		_, _, err := readUpload(upload(meta, uploadPart{"a", strings.Repeat("x", size)}, uploadPart{"b", ""}))
		if size == maxFileBytes && err != nil || size > maxFileBytes && err != errFilesTooLarge {
			t.Fatalf("size %d: %v", size, err)
		}
	}
	// The limit applies to the sum, even when each individual file fits.
	if _, _, err := readUpload(upload(meta, uploadPart{"a", strings.Repeat("x", maxFileBytes/2)}, uploadPart{"b", strings.Repeat("x", maxFileBytes/2+1)})); err != errFilesTooLarge {
		t.Fatalf("combined file size: %v", err)
	}
}

func TestNormalizePath(t *testing.T) {
	for _, name := range []string{"", ".", "./", "/", "..", "a/..", "C:/x", `C:\x`, "a\x00b", "\xff"} {
		if _, err := normalizePath(name); err == nil {
			t.Errorf("accepted %q", name)
		}
	}
	for input, want := range map[string]string{
		"./answer//main.c": "answer/main.c", "レポート.pdf": "レポート.pdf", "answer/./file": "answer/file",
		"/etc/passwd": "etc/passwd", "../x": "x", "a/../x": "x", "a/../../x": "x",
		`a\b`: "a/b", "a\xffb": "ab",
	} {
		got, err := normalizePath(input)
		if err != nil || got != want {
			t.Errorf("%q => %q, %v", input, got, err)
		}
	}
}
