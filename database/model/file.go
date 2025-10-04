package model

import (
	"context"
	"time"

	"github.com/uptrace/bun"
)

type FileLocation struct {
	bun.BaseModel `bun:"table:filelocation"`

	ID   int64     `bun:"id,pk,autoincrement" json:"id"`
	Path string    `bun:"path,notnull" json:"path"`
	Ts   time.Time `bun:"ts,notnull" json:"ts"`
}

type FileReference struct {
	bun.BaseModel `bun:"table:filereference"`

	ID         int64 `bun:"id,pk,autoincrement" json:"id"`
	LectureID  int64 `bun:"lecture_id,notnull" json:"lecture_id"`
	ProblemID  int64 `bun:"problem_id,notnull" json:"problem_id"`
	LocationID int64 `bun:"location_id,notnull" json:"location_id"`

	FileLocation *FileLocation `bun:"rel:belongs-to,join:location_id=id"`
	Problem      *Problem      `bun:"rel:belongs-to,join:lecture_id=lecture_id,join:problem_id=problem_id"`
}

var _ bun.BeforeAppendModelHook = (*FileLocation)(nil)

func (f *FileLocation) BeforeAppendModel(ctx context.Context, query bun.Query) error {
	switch query.(type) {
	case *bun.InsertQuery, *bun.UpdateQuery:
		// remove fraction less than seconds (milliseconds, microeconds, ...)
		f.Ts = f.Ts.Truncate(time.Second)
	}
	return nil
}
