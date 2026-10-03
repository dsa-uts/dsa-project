package judge

import (
	"slices"
	"testing"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
	resource "github.com/dsa-uts/dsa-resource-spec"
)

func TestOrderedJobIDs(t *testing.T) {
	workflow := resource.Workflow{
		Jobs: map[string]resource.Job{
			"a-test": {
				Visibility: "public",
				Depends:    []string{"z-build"},
			},
			"z-build": {Visibility: "public"},
			"private": {Visibility: "private"},
		},
	}

	got, err := orderedJobIDs(workflow, store.ValidationKind)
	want := []string{"z-build", "a-test"}
	if err != nil || !slices.Equal(got, want) {
		t.Fatalf("got %v, %v; want %v", got, err, want)
	}

	job := workflow.Jobs["z-build"]
	job.Depends = []string{"a-test"}
	workflow.Jobs["z-build"] = job
	if _, err := orderedJobIDs(workflow, store.ValidationKind); err == nil {
		t.Fatal("cyclic dependencies must fail")
	}
}
