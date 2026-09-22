package resourceimport

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	resource "github.com/dsa-uts/dsa-resource-spec"
	"golang.org/x/mod/semver"
)

// A transport function keeps these checks independent of GitHub, DB and deployment.
type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestSourceValidation(t *testing.T) {
	for _, v := range []string{"v0.0.0", "v1.10.2", "v999999999999999999999999.0.0"} {
		if !ValidVersion(v) {
			t.Fatalf("rejected %q", v)
		}
	}
	for _, v := range []string{"", "1.2.3", "v1.2", "v01.2.3", "v1.2.3-rc.1", "v1.2.3+build", "v1.2.3\n", "v1.2.3/.."} {
		if ValidVersion(v) {
			t.Fatalf("accepted %q", v)
		}
	}
	if semver.Compare("v1.10.0", "v1.9.0") <= 0 {
		t.Fatal("Versions must compare numerically")
	}
	for _, u := range []string{"http://github.com/org/repo", "https://evil.test/org/repo", "https://token@github.com/org/repo", "https://github.com/org/repo/subdir", "https://github.com/org/repo?token=secret"} {
		if _, err := NewSource(u, ""); err == nil {
			t.Fatalf("accepted repository %q", u)
		}
	}
}

func TestPinnedFetchAndFailures(t *testing.T) {
	r := resource.Resource{Metadata: resource.Metadata{ID: "ex1", Name: "Example", Version: "v1.0.0"},
		Workflows: map[string]resource.Workflow{"judge": {Name: "Judge", Jobs: map[string]resource.Job{"test": {
			Visibility: "private", SandboxImage: "ghcr.io/example/judge@sha256:" + strings.Repeat("a", 64),
			Limits: resource.Limits{CPU: 1, PIDs: 1, Memory: 1, StdoutSize: 1, StderrSize: 1, WorkspaceSize: 1, ArtifactSize: 1},
			Steps:  []resource.Step{{Run: "true", Timeout: time.Second}},
		}}}},
	}
	snapshot, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	hash, err := r.Hash()
	if err != nil {
		t.Fatal(err)
	}
	sha := strings.Repeat("a", 40)
	index := `{"resources":{"ex1":{"v1.0.0":{"path":"release/ex1/v1.0.0.json","source-commit":"` + strings.Repeat("b", 40) + `","resource-hash":"` + hash + `"}}}}`
	for _, tc := range []struct {
		name, index, snapshot string
		status                int
		want                  error
	}{
		{"valid pretty-printed JSON uses Resource hash", index, string(snapshot), 200, nil},
		{"missing version", `{"resources":{}}`, string(snapshot), 200, ErrNotFound},
		{"invalid index", `{"resources":null}`, string(snapshot), 200, ErrInvalid},
		{"trailing index", index + `{}`, string(snapshot), 200, ErrInvalid},
		{"path traversal", strings.Replace(index, "release/ex1/v1.0.0.json", "release/../secret", 1), string(snapshot), 200, ErrInvalid},
		{"absolute URL", strings.Replace(index, "release/ex1/v1.0.0.json", "https://evil.test/secret", 1), string(snapshot), 200, ErrInvalid},
		{"unknown index field", strings.Replace(index, `"path":`, `"secret":"x","path":`, 1), string(snapshot), 200, ErrInvalid},
		{"mutable image", index, strings.Replace(string(snapshot), "@sha256:"+strings.Repeat("a", 64), ":latest", 1), 200, ErrInvalid},
		{"invalid snapshot", index, `{}`, 200, ErrInvalid},
		{"wrong ID", index, strings.Replace(string(snapshot), `"id": "ex1"`, `"id": "ex2"`, 1), 200, ErrInvalid},
		{"wrong Version", index, strings.Replace(string(snapshot), `"version": "v1.0.0"`, `"version": "v2.0.0"`, 1), 200, ErrInvalid},
		{"hash mismatch", strings.Replace(index, hash, "sha256:"+strings.Repeat("0", 64), 1), string(snapshot), 200, ErrHashMismatch},
		{"rate limit", index, "upstream secret", 403, ErrUnavailable},
		{"download not found", index, "upstream secret", 404, ErrUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source, err := NewSource("https://github.com/example/resources", "private-token")
			if err != nil {
				t.Fatal(err)
			}
			calls := 0
			source.client.Transport = transportFunc(func(req *http.Request) (*http.Response, error) {
				calls++
				if req.URL.Host != "api.github.com" || req.Header.Get("Authorization") != "Bearer private-token" {
					t.Fatal("unexpected host or authentication")
				}
				body := ""
				switch req.URL.Path {
				case "/repos/example/resources/commits/main":
					body = `{"sha":"` + sha + `"}`
				case "/repos/example/resources/contents/release/index.json":
					body = tc.index
				case "/repos/example/resources/contents/release/ex1/v1.0.0.json":
					body = tc.snapshot
				default:
					t.Fatalf("unexpected request %s", req.URL)
				}
				if calls > 1 && (req.URL.Query().Get("ref") != sha || req.Header.Get("Accept") != "application/vnd.github.raw+json") {
					t.Fatal("read not pinned to main SHA")
				}
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
			})
			got, err := source.Fetch(t.Context(), "ex1", "v1.0.0")
			if !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
			if tc.want == nil && (got.Metadata.Name != "Example" || calls != 3) {
				t.Fatalf("unexpected import: %v, calls %d", got, calls)
			}
		})
	}
}
