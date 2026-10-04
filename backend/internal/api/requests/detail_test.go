package requests

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	resource "github.com/dsa-uts/dsa-resource-spec"
)

func TestValidationDetailFinalSnapshot(t *testing.T) {
	input := store.ValidationDetail{
		ValidationRecord: store.ValidationRecord{ValidationSummary: store.ValidationSummary{State: store.CompletedState, Status: new(store.IE), ContentHash: strings.Repeat("a", 64)}},
		Resource: resource.Resource{Workflows: map[string]resource.Workflow{
			"basic": {Name: "Pinned name", Jobs: map[string]resource.Job{
				"build": {Visibility: "public", Steps: []resource.Step{
					{Name: "compile", Run: "make", Compile: true, Timeout: time.Second, Expected: resource.Expected{
						ExitCode: new(0), Stdout: &resource.OutputExpectation{Match: resource.MatchExact},
					}},
					{Name: "unrecorded", Run: "check"},
				}, Artifacts: &resource.Artifacts{Outputs: []resource.ArtifactOutput{
					{Name: "saved", Path: "result.json", ContentType: "application/json", Visibility: "public"},
					{Name: "failed", Path: "missing", ContentType: "text/plain", Visibility: "public"},
					{Name: "unrecorded", Path: "not-run", ContentType: "text/plain", Visibility: "public"},
					{Name: "private-artifact", Visibility: "private"},
				}}},
				"after":   {Visibility: "public", Depends: []string{"build"}, Steps: []resource.Step{{Run: "after"}}},
				"skipped": {Visibility: "public", Steps: []resource.Step{{Run: "skipped"}}},
				"secret":  {Visibility: "private", Steps: []resource.Step{{Run: "PRIVATE COMMAND"}}},
			}},
			"later": {Jobs: map[string]resource.Job{"job": {Visibility: "public", Steps: []resource.Step{{Run: "later"}}}}},
		}},
		Results: []store.WorkflowResult{{WorkflowID: "basic", Status: store.IE, DurationMS: 150, Details: store.WorkflowDetails{Jobs: []store.JobResult{
			{ID: "build", Status: store.CE, StartedAt: time.Unix(0, 0), FinishedAt: time.Unix(0, 100_000_000),
				StopReason: "internal reason", Steps: []store.StepResult{{Index: 0, Status: store.CE, ExitCode: -1, DurationMS: new(int64(42)), MemoryBytes: new(int64(123)),
					Stdout: store.OutputResult{Data: []byte{0xff, 0, 10}, Truncated: true}}},
				Artifacts: []store.ArtifactResult{{Name: "failed", Status: store.WA, Error: "/private/internal/path"}}},
			{ID: "skipped", Status: store.SKIP, SkipReason: "required private-artifact missing"},
			{ID: "secret", Status: store.AC, Steps: []store.StepResult{{Index: 0, MemoryBytes: new(int64(999)), Stdout: store.OutputResult{Data: []byte("PRIVATE LOG")}}}},
		}}}},
		Artifacts: []store.ArtifactMetadata{
			{WorkflowID: "basic", JobID: "build", Name: "saved", SizeBytes: new(int64(0))},
			{WorkflowID: "basic", JobID: "build", Name: "failed", Error: new("/private/internal/path")},
		},
	}
	body, err := validationDetail(input)
	if err != nil {
		t.Fatal(err)
	}
	if body.Result == nil || *body.Status != generated.NullableStatus(store.IE) || *body.Result.PeakMemoryBytes != 123 {
		t.Fatalf("request verdict and visible peak: %+v", body)
	}
	workflow := body.Result.Workflows[0]
	if workflow.Name != "Pinned name" || len(workflow.Jobs) != 3 || workflow.Jobs[0].Id != "build" || workflow.Jobs[1].Id != "after" {
		t.Fatalf("pinned definitions and dependency order: %+v", workflow)
	}
	job := workflow.Jobs[0]
	step := job.Steps[0]
	if *job.DurationMs != 100 || *step.DurationMs != 42 || step.ExitCode != nil || step.Stdout.Data != base64.StdEncoding.EncodeToString([]byte{0xff, 0, 10}) || !step.Stdout.Truncated {
		t.Fatalf("actual measurements and raw output: %+v", step)
	}
	if step.Expected.Stdout == nil || step.Expected.Stdout.Data != "" || step.Expected.Stderr != nil || step.Stderr == nil || step.Stderr.Data != "" {
		t.Fatalf("unchecked, empty expectation and empty result must differ: %+v", step)
	}
	if len(job.Artifacts) != 3 || !job.Artifacts[0].Available || *job.Artifacts[0].SizeBytes != 0 || job.Artifacts[0].Status != nil {
		t.Fatalf("bytes saved without a final capture verdict: %+v", job.Artifacts)
	}
	for _, missing := range []generated.ValidationStep{job.Steps[1], workflow.Jobs[1].Steps[0], body.Result.Workflows[1].Jobs[0].Steps[0]} {
		if missing.Status != nil || missing.Stdout != nil || missing.DurationMs != nil || missing.MemoryBytes != nil || missing.ExitCode != nil || missing.Run == "" {
			t.Fatalf("missing results must retain only definitions: %+v", missing)
		}
	}
	if *workflow.Jobs[2].Status != generated.NullableStatus(store.SKIP) || workflow.Jobs[2].SkipReason == nil || job.StopReason == nil {
		t.Fatal("explicit SKIP and stop reasons must survive")
	}
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"PRIVATE", "/private/internal", "private-artifact", "secret"} {
		if bytes.Contains(data, []byte(secret)) {
			t.Fatalf("leaked %q in response", secret)
		}
	}
	spec, err := generated.GetSpec()
	if err != nil {
		t.Fatal(err)
	}
	var response any
	if err := json.Unmarshal(data, &response); err != nil {
		t.Fatal(err)
	}
	if err := spec.Components.Schemas["ValidationDetail"].Value.VisitJSON(response); err != nil {
		t.Fatalf("response violates OpenAPI: %v", err)
	}
	for _, state := range []store.RequestState{store.PendingState, store.RunningState, store.RetryingState} {
		input.State = state
		input.Status, input.DurationMS = nil, nil
		body, err := validationDetail(input)
		if err != nil || body.Result != nil {
			t.Fatalf("%s must hide results: %+v, %v", state, body, err)
		}
	}
	input.State = store.CompletedState
	input.Results = nil
	body, err = validationDetail(input)
	if err != nil || body.Result == nil || body.Result.PeakMemoryBytes != nil || body.Result.Workflows[0].Status != nil {
		t.Fatalf("completed IE without saved results: %+v, %v", body, err)
	}
}

func TestValidationFilesMultipart(t *testing.T) {
	metadata, files := validationFiles(store.ValidationFiles{
		Submission: []store.SubmissionFile{{Path: "日本語/answer.bin", Content: []byte{0, 255}}, {Path: "empty", Content: []byte{}}},
		Resource: resource.Resource{Workflows: map[string]resource.Workflow{
			"private-only": {Presets: []resource.Preset{{Path: "same", Content: []byte("preset")}}},
			"basic":        {Presets: []resource.Preset{{Path: "same", Content: []byte("other")}}},
		}},
	})
	if metadata.Presets[0].WorkflowId != "basic" || len(metadata.Presets) != 2 {
		t.Fatalf("all Presets must be grouped in Workflow order: %+v", metadata)
	}
	write, err := fileMultipart(metadata, files)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	if err := write(writer); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	reader := multipart.NewReader(&buf, writer.Boundary())
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "metadata" || part.FileName() != "" || part.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("metadata must be a JSON text field: %v, %v", part, err)
	}
	var decoded generated.ValidationFilesMetadata
	if err := json.NewDecoder(part).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(decoded, metadata) {
		t.Fatalf("metadata roundtrip: %+v", decoded)
	}
	for i, file := range files {
		part, err := reader.NextPart()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(part)
		if err != nil || !bytes.Equal(data, file.content) || !strings.HasPrefix(part.FormName(), "file") {
			t.Fatalf("binary part %d: %v", i, err)
		}
	}
	if _, err := reader.NextPart(); err != io.EOF {
		t.Fatalf("closing boundary: %v", err)
	}
}

func TestArtifactFilesVisibilityAndIdentity(t *testing.T) {
	public := resource.ArtifactOutput{Name: "output", Path: "same.json", Visibility: "public", ContentType: "application/json"}
	private := resource.ArtifactOutput{Name: "secret", Path: "private.bin", Visibility: "private"}
	input := store.ValidationArtifacts{
		Resource: resource.Resource{Workflows: map[string]resource.Workflow{
			"one": {Jobs: map[string]resource.Job{
				"public":  {Visibility: "public", Artifacts: &resource.Artifacts{Outputs: []resource.ArtifactOutput{public, private}}},
				"private": {Visibility: "private", Artifacts: &resource.Artifacts{Outputs: []resource.ArtifactOutput{public}}},
			}},
			"two": {Jobs: map[string]resource.Job{
				"public": {Visibility: "public", Artifacts: &resource.Artifacts{Outputs: []resource.ArtifactOutput{public}}},
			}},
		}},
		Files: []store.Artifact{
			{WorkflowID: "one", JobID: "public", Name: "output", Content: []byte{0xff, 0}},
			{WorkflowID: "one", JobID: "public", Name: "secret", Content: []byte("secret")},
			{WorkflowID: "one", JobID: "private", Name: "output", Content: []byte("private job")},
			{WorkflowID: "two", JobID: "public", Name: "output", Content: []byte{}},
		},
	}
	metadata, files := artifactFiles(input)
	if len(files) != 2 || len(metadata.Files) != 2 || !bytes.Equal(files[0].content, []byte{0xff, 0}) || len(files[1].content) != 0 {
		t.Fatalf("only declared public files should survive: %+v", metadata)
	}
	for i, id := range []string{"one", "two"} {
		part := metadata.Files[i]
		if part.WorkflowId != id || part.JobId != "public" || part.Name != "output" || part.Path != "same.json" || part.ContentType != "application/json" {
			t.Fatalf("Artifact identity and declaration: %+v", part)
		}
	}
	if metadata.Files[0].Part == metadata.Files[1].Part {
		t.Fatal("same paths in distinct Workflows must have distinct multipart names")
	}
}
