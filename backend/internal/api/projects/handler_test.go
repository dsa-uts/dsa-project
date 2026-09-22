package projects

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/google/uuid"
)

func TestProjectDetail(t *testing.T) {
	p := &store.ProjectLatest{Project: store.Project{
		ID: uuid.New(), ResourceID: "ex1", Name: "Example", LatestVersionID: uuid.New(), DisplayOrder: 3,
	}, Version: "v1.0.0", ResourceJSON: json.RawMessage(`{
		"required-files": ["z.c", "*.h", "レポート.pdf（任意）"],
		"workflows": {
			"ex1-2": {"name": "Second", "jobs": {"private": {"secret": "must-not-leak"}}},
			"ex1-10": {"name": "Tenth", "description": "# Markdown\n\n[Link](https://example.com)", "presets": ["must-not-leak"]},
			"ex1-1": {"name": "First"}
		}
	}`)}
	detail, err := projectDetail(p)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Id != p.ID || detail.LatestVersionId != p.LatestVersionID || detail.LatestVersion != p.Version || detail.ResourceId != p.ResourceID || detail.Name != p.Name || detail.DisplayOrder != 3 {
		t.Fatalf("lost Project metadata: %+v", detail)
	}
	if !reflect.DeepEqual(detail.RequiredFiles, []string{"z.c", "*.h", "レポート.pdf（任意）"}) {
		t.Fatalf("changed file guidance: %v", detail.RequiredFiles)
	}
	if len(detail.Workflows) != 3 || detail.Workflows[0].Id != "ex1-1" || detail.Workflows[1].Id != "ex1-10" || detail.Workflows[2].Id != "ex1-2" || detail.Workflows[0].DescriptionMarkdown != "" || detail.Workflows[1].DescriptionMarkdown != "# Markdown\n\n[Link](https://example.com)" {
		t.Fatalf("unexpected Workflows: %+v", detail.Workflows)
	}
	data, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"must-not-leak", "jobs", "presets"} {
		if strings.Contains(string(data), forbidden) {
			t.Fatalf("exposed private data: %s", data)
		}
	}
	if !strings.Contains(string(data), `"my_result":null`) {
		t.Fatalf("expected null result: %s", data)
	}
	// Snapshots imported before required-files existed remain readable.
	p.ResourceJSON = json.RawMessage(`{"workflows":{"judge":{"name":"Judge"}}}`)
	detail, err = projectDetail(p)
	if err != nil || detail.RequiredFiles == nil || len(detail.RequiredFiles) != 0 {
		t.Fatalf("missing guidance must be an empty array: %+v, %v", detail, err)
	}
	p.ResourceJSON = json.RawMessage(`{`)
	if _, err := projectDetail(p); err == nil {
		t.Fatal("corrupt snapshot accepted")
	}
}
