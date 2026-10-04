package requests

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"path"
	"slices"
	"strings"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

const maxFileBytes = 20_000_000

// The OpenAPI middleware validates the metadata shape. This layer validates
// relationships between parts and paths, and counts actual file bytes.
func readUpload(reader *multipart.Reader) ([]store.SubmissionFile, string, error) {
	parts := map[string][]byte{}
	var metadata generated.SubmissionMetadata
	total := 0
	for {
		part, err := reader.NextRawPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, "", fmt.Errorf("Invalid multipart: %w", err)
		}
		name := part.FormName()
		if _, exists := parts[name]; exists || name == "" {
			return nil, "", fmt.Errorf("Duplicate or empty part name: %q.", name)
		}
		if part.Header.Get("Content-Transfer-Encoding") != "" {
			return nil, "", fmt.Errorf("Part %q must contain unencoded bytes.", name)
		}
		if len(parts) >= 51 {
			return nil, "", fmt.Errorf("At most 50 file parts are allowed.")
		}
		data, err := io.ReadAll(io.LimitReader(part, maxFileBytes+1))
		if err != nil {
			return nil, "", err
		}
		parts[name] = data
		if name == "metadata" {
			media, _, err := mime.ParseMediaType(part.Header.Get("Content-Type"))
			if err != nil || media != "application/json" {
				return nil, "", fmt.Errorf("metadata must have Content-Type application/json.")
			}
			if err := json.Unmarshal(data, &metadata); err != nil {
				return nil, "", err
			}
		} else {
			total += len(data)
			if total > maxFileBytes {
				return nil, "", errFilesTooLarge
			}
		}
	}
	if _, exists := parts["metadata"]; !exists {
		return nil, "", fmt.Errorf("Missing metadata part.")
	}
	delete(parts, "metadata")
	files := make([]store.SubmissionFile, 0, len(metadata.Files))
	paths := map[string]bool{}
	for _, file := range metadata.Files {
		content, exists := parts[file.Part]
		if !exists {
			return nil, "", fmt.Errorf("Missing or repeated file part: %q.", file.Part)
		}
		delete(parts, file.Part)
		normalized, err := normalizePath(file.Path)
		if err != nil {
			return nil, "", err
		}
		if paths[normalized] {
			return nil, "", fmt.Errorf("Duplicate path: %q.", normalized)
		}
		paths[normalized] = true
		files = append(files, store.SubmissionFile{Path: normalized, Content: content})
	}
	if len(parts) != 0 {
		return nil, "", fmt.Errorf("Unreferenced file parts.")
	}
	for name := range paths {
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			if paths[parent] {
				return nil, "", fmt.Errorf("Conflicting paths: %q and %q.", parent, name)
			}
		}
	}
	slices.SortFunc(files, func(a, b store.SubmissionFile) int { return strings.Compare(a.Path, b.Path) })
	h := sha256.New()
	for _, file := range files {
		// Length prefixes make the tree encoding unambiguous, including binary content.
		_ = binary.Write(h, binary.BigEndian, uint64(len(file.Path)))
		_, _ = io.WriteString(h, file.Path)
		_ = binary.Write(h, binary.BigEndian, uint64(len(file.Content)))
		_, _ = h.Write(file.Content)
	}
	return files, hex.EncodeToString(h.Sum(nil)), nil
}

func normalizePath(name string) (string, error) {
	normalized := strings.ToValidUTF8(name, "")
	normalized = strings.ReplaceAll(normalized, "\\", "/")

	// Refuse NUL and "C://"
	if strings.ContainsRune(normalized, '\x00') || (len(normalized) >= 2 && normalized[1] == ':') {
		return "", fmt.Errorf("Invalid relative path: %q.", name)
	}

	normalized = strings.TrimPrefix(path.Clean("/"+normalized), "/")
	if normalized == "" {
		return "", fmt.Errorf("Invalid relative path: %q.", name)
	}

	return normalized, nil
}
