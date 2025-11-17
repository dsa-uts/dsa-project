package model

import (
	"context"
	"time"

	"github.com/uptrace/bun"
)

type Lecture struct {
	bun.BaseModel `bun:"table:lecture"`

	ID        int64     `bun:"id,pk,autoincrement" json:"id"`
	Title     string    `bun:"title,notnull" json:"title"`
	StartDate time.Time `bun:"start_date,notnull" json:"start_date"`
	Deadline  time.Time `bun:"deadline,notnull" json:"deadline"`

	Problems []*Problem `bun:"rel:has-many,join:id=lecture_id" json:"problems,omitempty"`
}

type Problem struct {
	bun.BaseModel `bun:"table:problem"`

	LectureID          int64     `bun:"lecture_id,pk,notnull" json:"lecture_id"`
	ProblemID          int64     `bun:"problem_id,pk,notnull" json:"problem_id"`
	RegisteredAt       time.Time `bun:"registered_at,notnull,default:current_timestamp" json:"registered_at"`
	Title              string    `bun:"title,notnull" json:"title"`
	ResourceLocationID int64     `bun:"resource_location_id,notnull" json:"resource_location_id"`
	Detail             Detail    `bun:"detail,notnull,type:jsonb" json:"detail"`
}

type Detail struct {
	DescriptionPath string     `json:"description_path"`
	TimeMS          int64      `json:"time_ms"`
	MemoryMB        int64      `json:"memory_mb"`
	TestFiles       []string   `json:"test_files"`
	RequiredFiles   []string   `json:"required_files"`
	BuildTasks      []TestCase `json:"build"`
	JudgeTasks      []TestCase `json:"judge"`
}

type TestCase struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Command     string `json:"command"`
	Evaluation  bool   `json:"eval_only"`
	StdinPath   string `json:"stdin"`
	StdoutPath  string `json:"stdout"`
	StderrPath  string `json:"stderr"`
	ExitCode    int64  `json:"exit"`
	IgnoreExit  bool   `json:"ignore_exit"`
}

func MakeTestCase(id int64, title, description, command string, evalOnly bool, stdinPath, stdoutPath, stderrPath string, exitCode int64, ignoreExit bool) TestCase {
	return TestCase{
		ID:          id,
		Title:       title,
		Description: description,
		Command:     command,
		Evaluation:  evalOnly,
		StdinPath:   stdinPath,
		StdoutPath:  stdoutPath,
		StderrPath:  stderrPath,
		ExitCode:    exitCode,
		IgnoreExit:  ignoreExit,
	}
}

var _ bun.BeforeAppendModelHook = (*Lecture)(nil)

func (l *Lecture) BeforeAppendModel(ctx context.Context, query bun.Query) error {
	switch query.(type) {
	case *bun.InsertQuery, *bun.UpdateQuery:
		// remove fraction less than seconds (milliseconds, microseconds, ...)
		l.StartDate = l.StartDate.Truncate(time.Second)
		l.Deadline = l.Deadline.Truncate(time.Second)
	}
	return nil
}

var _ bun.BeforeAppendModelHook = (*Problem)(nil)

func (p *Problem) BeforeAppendModel(ctx context.Context, query bun.Query) error {
	switch query.(type) {
	case *bun.InsertQuery, *bun.UpdateQuery:
		// remove fraction less than seconds (milliseconds, microseconds, ...)
		p.RegisteredAt = p.RegisteredAt.Truncate(time.Second)
	}
	return nil
}
