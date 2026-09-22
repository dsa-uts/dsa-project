// Package resourceimport fetches and validates immutable GitHub releases.
package resourceimport

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	resource "github.com/dsa-uts/dsa-resource-spec"
)

var (
	ErrNotFound       = errors.New("resource_version_not_found")
	ErrInvalid        = errors.New("invalid_resource")
	ErrHashMismatch   = errors.New("resource_hash_mismatch")
	ErrUnavailable    = errors.New("resource_source_unavailable")
	identifier        = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
	versionPattern    = regexp.MustCompile(`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)
	commitPattern     = regexp.MustCompile(`^[0-9a-f]{40,64}$`)
	repositoryPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$`)
)

func ValidVersion(version string) bool { return versionPattern.MatchString(version) }

type Source struct {
	repository string
	token      string
	client     *http.Client
}

func NewSource(repositoryURL, token string) (*Source, error) {
	u, err := url.Parse(repositoryURL)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("RESOURCE_REPOSITORY_URL must be an HTTPS github.com repository URL")
	}
	repository := strings.TrimSuffix(strings.Trim(strings.TrimSuffix(u.Path, ".git"), "/"), ".git")
	if !repositoryPattern.MatchString(repository) || strings.HasSuffix(repository, "/.") || strings.HasSuffix(repository, "/..") {
		return nil, errors.New("RESOURCE_REPOSITORY_URL must identify one owner/repository")
	}
	return &Source{repository: repository, token: token, client: &http.Client{
		Timeout:       30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

// Fetch pins all reads to one main SHA. Upstream errors never contain response bodies or credentials.
func (s *Source) Fetch(ctx context.Context, id, version string) (*resource.Resource, error) {
	if !identifier.MatchString(id) || !ValidVersion(version) {
		return nil, ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	data, err := s.get(ctx, "/commits/main", "application/vnd.github+json")
	if err != nil {
		return nil, err
	}
	var commit struct {
		SHA string `json:"sha"`
	}
	if json.Unmarshal(data, &commit) != nil || !commitPattern.MatchString(commit.SHA) {
		return nil, ErrUnavailable
	}
	data, err = s.get(ctx, "/contents/release/index.json?ref="+commit.SHA, "application/vnd.github.raw+json")
	if err != nil {
		return nil, err
	}
	entry, err := decodeIndex(data, id, version)
	if err != nil {
		return nil, err
	}
	data, err = s.get(ctx, "/contents/"+entry.Path+"?ref="+commit.SHA, "application/vnd.github.raw+json")
	if err != nil {
		return nil, err
	}
	return decodeSnapshot(data, id, version, entry.ResourceHash)
}

func (s *Source) get(ctx context.Context, path, accept string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/"+s.repository+path, nil)
	if err != nil {
		return nil, ErrUnavailable
	}
	req.Header.Set("Accept", accept)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, ErrUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, ErrUnavailable
	}
	// Bound untrusted downloads, including chunked responses without Content-Length.
	const maxBytes = 64 << 20
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil || len(data) > maxBytes {
		return nil, ErrUnavailable
	}
	return data, nil
}

type indexEntry struct {
	Path         string `json:"path"`
	SourceCommit string `json:"source-commit"`
	ResourceHash string `json:"resource-hash"`
}

func decodeIndex(data []byte, id, version string) (indexEntry, error) {
	var index struct {
		Resources map[string]map[string]indexEntry `json:"resources"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&index) != nil || decoder.Decode(new(any)) != io.EOF || index.Resources == nil {
		return indexEntry{}, ErrInvalid
	}
	versionList, ok := index.Resources[id]
	if !ok {
		return indexEntry{}, ErrNotFound
	}
	entry, ok := versionList[version]
	if !ok {
		return indexEntry{}, ErrNotFound
	}
	if entry.Path != "release/"+id+"/"+version+".json" {
        return indexEntry{}, ErrInvalid
  }
	return entry, nil
}

func decodeSnapshot(data []byte, id, version, expectedHash string) (*resource.Resource, error) {
	r, err := resource.DecodeResource(bytes.NewReader(data))
	if err != nil || r.Metadata.ID != id || r.Metadata.Version != version {
		return nil, ErrInvalid
	}
	// DecodeResource checks image syntax but also permits mutable tags for
	// authoring. Published snapshots must carry a digest.
	for _, workflow := range r.Workflows {
		for _, job := range workflow.Jobs {
			if !strings.Contains(job.SandboxImage, "@") {
				return nil, ErrInvalid
			}
		}
	}
	hash, err := r.Hash()
	if err != nil {
		return nil, ErrInvalid
	}
	if hash != expectedHash {
		return nil, ErrHashMismatch
	}
	return r, nil
}
