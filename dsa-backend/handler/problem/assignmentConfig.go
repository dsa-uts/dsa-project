package problem

import (
	"encoding/json"
	"errors"
	"path/filepath"
)

type AssignmentConfig struct {
	SubID         int        `json:"sub_id"`
	Title         string     `json:"title"`
	MDfile        string     `json:"md_file"`
	TimeMS        *int64     `json:"time_ms,omitempty"`
	MemoryMB      *int64     `json:"memory_mb,omitempty"`
	TestFiles     []string   `json:"test_files"`
	RequiredFiles []string   `json:"required_files"`
	Build         []TestCase `json:"build"`
	Judge         []TestCase `json:"judge"`
}

type TestCase struct {
	EvalOnly      *bool  `json:"eval_only,omitempty"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	MessageOnFail string `json:"message_on_fail,omitempty"`
	Command       string `json:"command"`
	Stdin         string `json:"stdin,omitempty"`
	Stdout        string `json:"stdout,omitempty"`
	Stderr        string `json:"stderr,omitempty"`
	ExitCode      *int64 `json:"exit,omitempty"`
}

func (ac *AssignmentConfig) Decode(data []byte) error {
	if err := json.Unmarshal(data, ac); err != nil {
		return errors.New("Failed to parse assignment config: " + err.Error())
	}

	ac.setDefaults()

	// Clean all path to avoid path traversal attack
	ac.MDfile = CleanPath(ac.MDfile)
	for i := range ac.TestFiles {
		ac.TestFiles[i] = CleanPath(ac.TestFiles[i])
	}

	for i := range ac.Build {
		if ac.Build[i].Stdin != "" {
			ac.Build[i].Stdin = CleanPath(ac.Build[i].Stdin)
		}
		if ac.Build[i].Command != "" {
			ac.Build[i].Stdout = CleanPath(ac.Build[i].Stdout)
		}
		if ac.Build[i].Stderr != "" {
			ac.Build[i].Stderr = CleanPath(ac.Build[i].Stderr)
		}
	}

	for i := range ac.Judge {
		if ac.Judge[i].Stdin != "" {
			ac.Judge[i].Stdin = CleanPath(ac.Judge[i].Stdin)
		}
		if ac.Judge[i].Stdout != "" {
			ac.Judge[i].Stdout = CleanPath(ac.Judge[i].Stdout)
		}
		if ac.Judge[i].Stderr != "" {
			ac.Judge[i].Stderr = CleanPath(ac.Judge[i].Stderr)
		}
	}

	return nil
}

func CleanPath(p string) string {
	new_p := filepath.Join("/", filepath.Clean(p))
	return new_p[1:]
}

func (conf *AssignmentConfig) setDefaults() {
	if conf.TimeMS == nil {
		defaultTime := int64(1000) // Default time in milliseconds
		conf.TimeMS = &defaultTime
	}
	if conf.MemoryMB == nil {
		defaultMemory := int64(256) // Default memory in MB
		conf.MemoryMB = &defaultMemory
	}

	for i := range conf.Build {
		conf.Build[i].setDefaults()
	}

	for i := range conf.Judge {
		conf.Judge[i].setDefaults()
	}
}

func (t *TestCase) setDefaults() {
	if t.EvalOnly == nil {
		defaultEvalOnly := false
		t.EvalOnly = &defaultEvalOnly
	}
	if t.ExitCode == nil {
		defaultExitCode := int64(0)
		t.ExitCode = &defaultExitCode
	}
	if t.MessageOnFail == "" {
		t.MessageOnFail = "failed to execute " + t.Title
	}
}
