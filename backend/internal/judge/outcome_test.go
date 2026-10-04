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
				got := judgeStep(resource.Step{Expected: expected, Compile: compile}, tt.result)
				if got != want {
					t.Errorf("judgeStep(compile=%v) = %q, want %q", compile, got, want)
				}
			}
		})
	}
}

func TestJudgeStepSkipsOutputComparisonAfterExecutionFailure(t *testing.T) {
	zero := 0
	step := resource.Step{Expected: resource.Expected{
		ExitCode: &zero,
		Stdout:   &resource.OutputExpectation{Match: "invalid"},
	}}
	for _, compile := range []bool{false, true} {
		step.Compile = compile
		want := store.RE
		if compile {
			want = store.CE
		}
		if got := judgeStep(step, store.StepResult{ExitCode: 1}); got != want {
			t.Errorf("judgeStep(compile=%v) = %q, want %q", compile, got, want)
		}
	}
}

func TestJudgeStepOutputComparison(t *testing.T) {
	tests := []struct {
		name     string
		expected *resource.OutputExpectation
		actual   string
		want     store.Status
	}{
		{"omitted expectation", nil, "anything", store.AC},
		{"empty expectation", &resource.OutputExpectation{Match: resource.MatchExact}, "unexpected", store.WA},
		{"easy mode", &resource.OutputExpectation{Content: []byte("a b"), Match: resource.MatchEasy}, "a  b\n", store.AC},
		{"sorted mode", &resource.OutputExpectation{Content: []byte("a b"), Match: resource.MatchSorted}, "b a", store.AC},
		{"unknown mode equal", &resource.OutputExpectation{Content: []byte("a b"), Match: "invalid"}, "a b", store.AC},
		{"unknown mode uses exact", &resource.OutputExpectation{Content: []byte("a b"), Match: "invalid"}, "a  b", store.WA},
		{"empty mode equal", &resource.OutputExpectation{Content: []byte("a b")}, "a b", store.AC},
		{"empty mode uses exact", &resource.OutputExpectation{Content: []byte("a b")}, "a  b", store.WA},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, stderr := range []bool{false, true} {
				for _, compile := range []bool{false, true} {
					step := resource.Step{Compile: compile}
					result := store.StepResult{}
					if stderr {
						step.Expected.Stderr = tt.expected
						result.Stderr.Data = []byte(tt.actual)
					} else {
						step.Expected.Stdout = tt.expected
						result.Stdout.Data = []byte(tt.actual)
					}
					want := tt.want
					if compile && want != store.AC {
						want = store.CE
					}
					if got := judgeStep(step, result); got != want {
						t.Errorf("judgeStep(stderr=%v, compile=%v) = %q, want %q", stderr, compile, got, want)
					}
				}
			}
		})
	}
}

func TestSummarizeWorkflow(t *testing.T) {
	duration, memory := int64(12), int64(300)
	shorter, larger := int64(4), int64(500)
	result := store.WorkflowResult{Details: store.WorkflowDetails{Jobs: []store.JobResult{
		{Status: store.AC, Steps: []store.StepResult{{DurationMS: &duration, MemoryBytes: &memory}}},
		{Status: store.IE, Steps: []store.StepResult{{DurationMS: &shorter, MemoryBytes: &larger}, {Status: store.IE}}},
	}}}
	summarizeWorkflow(&result, errors.New("execute job failed"))
	if result.Status != store.IE {
		t.Errorf("status = %q, want IE", result.Status)
	}
	if result.MaxStepDurationMS == nil || *result.MaxStepDurationMS != duration {
		t.Errorf("max duration = %v, want %d", result.MaxStepDurationMS, duration)
	}
	if result.PeakMemoryBytes == nil || *result.PeakMemoryBytes != larger {
		t.Errorf("peak memory = %v, want %d", result.PeakMemoryBytes, larger)
	}
	empty := store.WorkflowResult{}
	summarizeWorkflow(&empty, nil)
	if empty.MaxStepDurationMS != nil || empty.PeakMemoryBytes != nil {
		t.Fatal("unmeasured workflow must retain nil measurements")
	}
}

func TestSummarizeWorkflowStatus(t *testing.T) {
	tests := []struct {
		name         string
		statuses     []store.Status
		executionErr error
		want         store.Status
	}{
		{name: "no jobs", want: store.AC},
		{name: "accepted", statuses: []store.Status{store.AC}, want: store.AC},
		{name: "last job fails", statuses: []store.Status{store.AC, store.IE}, want: store.IE},
		{name: "earlier failure survives", statuses: []store.Status{store.TLE, store.AC}, want: store.TLE},
		{name: "error before first job", executionErr: errors.New("invalid dependencies"), want: store.IE},
		{name: "error between jobs", statuses: []store.Status{store.AC}, executionErr: errors.New("canceled"), want: store.IE},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := store.WorkflowResult{}
			for _, status := range tt.statuses {
				result.Details.Jobs = append(result.Details.Jobs, store.JobResult{Status: status})
			}
			summarizeWorkflow(&result, tt.executionErr)
			if result.Status != tt.want {
				t.Errorf("status = %q, want %q", result.Status, tt.want)
			}
		})
	}
}
