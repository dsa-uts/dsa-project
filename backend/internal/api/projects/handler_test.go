package projects

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
	resource "github.com/dsa-uts/dsa-resource-spec"
	"github.com/google/uuid"
)

func TestProjectDetail(t *testing.T) {
	p := &store.ProjectLatest{Project: store.Project{
		ID: uuid.New(), ResourceID: "ex1", Name: "Example", LatestVersionID: uuid.New(), DisplayOrder: 3,
	}, Version: "v1.0.0", ResourceJSON: resource.Resource{
		Metadata:      resource.Metadata{Description: "C言語によるプログラミングの復習"},
		RequiredFiles: []string{"z.c", "*.h", "レポート.pdf（任意）"},
		Workflows: map[string]resource.Workflow{
			"ex1-2":  {Name: "Second", Jobs: map[string]resource.Job{"private": {Name: "must-not-leak"}}},
			"ex1-10": {Name: "Tenth", Description: "# Markdown\n\n[Link](https://example.com)", Presets: []resource.Preset{{Path: "must-not-leak"}}},
			"ex1-1":  {Name: "First"},
		},
	}}
	detail := projectDetail(p)
	if detail.Id != p.ID || detail.LatestVersionId != p.LatestVersionID || detail.LatestVersion != p.Version || detail.ResourceId != p.ResourceID || detail.Name != p.Name || detail.DisplayOrder != 3 || detail.Description != p.ResourceJSON.Metadata.Description {
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
}

func TestProjectDetailMissingGuidance(t *testing.T) {
	// Snapshots imported before optional metadata existed remain readable.
	detail := projectDetail(&store.ProjectLatest{ResourceJSON: resource.Resource{
		Workflows: map[string]resource.Workflow{"judge": {Name: "Judge"}},
	}})
	if detail.Description != "" {
		t.Fatalf("missing description must be empty: %+v", detail)
	}
	if detail.RequiredFiles == nil || len(detail.RequiredFiles) != 0 {
		t.Fatalf("missing guidance must be an empty array: %+v", detail)
	}
}
