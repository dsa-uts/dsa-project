package store

import (
	"fmt"
	"maps"
	"slices"
	"strings"

	resource "github.com/dsa-uts/dsa-resource-spec"
)

// OrderedJobIDs orders selected Jobs by dependencies, breaking ties by ID.
func OrderedJobIDs(workflow resource.Workflow, kind SubmissionKind) ([]string, error) {
	if kind != ValidationKind && kind != EvaluationKind {
		return nil, fmt.Errorf("unknown submission kind %q", kind)
	}

	pending := slices.Sorted(maps.Keys(workflow.Jobs))
	if kind == ValidationKind {
		pending = slices.DeleteFunc(pending, func(id string) bool {
			return workflow.Jobs[id].Visibility != "public"
		})
	}

	order := make([]string, 0, len(pending))
	done := make(map[string]bool, len(pending))

	for len(pending) > 0 {
		ready := -1
		for i, id := range pending {
			if slices.ContainsFunc(workflow.Jobs[id].Depends, func(dep string) bool {
				return !done[dep]
			}) {
				continue
			}
			ready = i
			break
		}

		if ready < 0 {
			return nil, fmt.Errorf("unresolvable job dependencies: %s", strings.Join(pending, ","))
		}

		id := pending[ready]
		order = append(order, id)
		done[id] = true
		pending = slices.Delete(pending, ready, ready+1)
	}

	return order, nil
}
