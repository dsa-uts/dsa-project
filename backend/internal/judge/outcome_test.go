package judge

import (
	"errors"
	"fmt"
	"testing"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
	resource "github.com/dsa-uts/dsa-resource-spec"
)

func TestAttemptOutcome(t *testing.T) {
	internalErr := errors.New("docker unavailable")
	tests := []struct {
		name         string
		attempt      int32
		results      []store.WorkflowResult
		executionErr error
		wantState    store.RequestState
		wantStatus   store.Status // Empty means SQL NULL for a retry.
		wantErr      bool
	}{
		{name: "accepted", results: []store.WorkflowResult{{Status: store.AC}}, wantState: store.CompletedState, wantStatus: store.AC},
		{name: "worst workflow wins", results: []store.WorkflowResult{{Status: store.WA}, {Status: store.TLE}, {Status: store.AC}}, wantState: store.CompletedState, wantStatus: store.TLE},
		{name: "retry first attempt", attempt: 1, executionErr: internalErr, wantState: store.RetryingState},
		{name: "retry second attempt with partial results", attempt: 2, results: []store.WorkflowResult{{Status: store.WA}}, executionErr: internalErr, wantState: store.RetryingState},
		{name: "complete final attempt", attempt: 3, executionErr: internalErr, wantState: store.CompletedState, wantStatus: store.IE},
		{name: "placement failure is terminal", attempt: 1, executionErr: fmt.Errorf("place: %w", errFilePlacement), wantState: store.CompletedState, wantStatus: store.IE},
		{name: "missing results", wantErr: true},
		{name: "invalid status", results: []store.WorkflowResult{{Status: "invalid"}}, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			state, status, err := attemptOutcome(tt.attempt, tt.results, tt.executionErr)
			if (err != nil) != tt.wantErr {
				t.Fatalf("attemptOutcome error = %v, want error %v", err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			if state != tt.wantState {
				t.Errorf("state = %q, want %q", state, tt.wantState)
			}
			if tt.wantStatus == "" {
				if status != nil {
					t.Errorf("status = %q, want nil", *status)
				}
			} else if status == nil || *status != tt.wantStatus {
				t.Errorf("status = %v, want %q", status, tt.wantStatus)
			}
		})
	}
}

func TestJudgeStep(t *testing.T) {
	zero := 0
	expected := resource.Expected{
		ExitCode: &zero,
		Stdout:   &resource.OutputExpectation{Content: []byte("expected"), Match: resource.MatchExact},
	}
	tests := []struct {
		name   string
		result store.StepResult
		want   store.Status
	}{
		{"accepted", store.StepResult{Stdout: store.OutputResult{Data: []byte("expected")}}, store.AC},
		{"wrong output", store.StepResult{}, store.WA},
		{"exit mismatch beats output mismatch", store.StepResult{ExitCode: 1}, store.RE},
		{"time limit beats exit mismatch", store.StepResult{TLE: true, ExitCode: 1}, store.TLE},
		{"memory limit beats time limit", store.StepResult{MLE: true, TLE: true}, store.MLE},
		{"output limit beats memory limit", store.StepResult{OLE: true, MLE: true, TLE: true}, store.OLE},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, compile := range []bool{false, true} {
				want := tt.want
				if compile && want != store.AC {
					want = store.CE
				}
				got, err := judgeStep(resource.Step{Expected: expected, Compile: compile}, tt.result)
				if err != nil || got != want {
					t.Errorf("judgeStep(compile=%v) = %q, %v; want %q, nil", compile, got, err, want)
				}
			}
		})
	}
}

func TestSummarizeWorkflowUsage(t *testing.T) {
	duration, memory := int64(12), int64(300)
	shorter, larger := int64(4), int64(500)
	result := store.WorkflowResult{Details: store.WorkflowDetails{Jobs: []store.JobResult{
		{Steps: []store.StepResult{{DurationMS: &duration, MemoryBytes: &memory}}},
		{Status: store.IE, Steps: []store.StepResult{{DurationMS: &shorter, MemoryBytes: &larger}, {Status: store.IE}}},
	}}}
	summarizeWorkflowUsage(&result)
	if result.MaxStepDurationMS == nil || *result.MaxStepDurationMS != duration {
		t.Errorf("max duration = %v, want %d", result.MaxStepDurationMS, duration)
	}
	if result.PeakMemoryBytes == nil || *result.PeakMemoryBytes != larger {
		t.Errorf("peak memory = %v, want %d", result.PeakMemoryBytes, larger)
	}
	empty := store.WorkflowResult{}
	summarizeWorkflowUsage(&empty)
	if empty.MaxStepDurationMS != nil || empty.PeakMemoryBytes != nil {
		t.Fatal("unmeasured workflow must retain nil measurements")
	}
}
