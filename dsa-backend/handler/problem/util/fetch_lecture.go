package util

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"time"

	"github.com/dsa-uts/dsa-project/database"
)

type LectureEntry struct {
	LectureID int64  `json:"lecture_id"`
	Title     string `json:"title"`
	StartDate int64  `json:"start_date"`
	Deadline  int64  `json:"deadline"`

	Problems []ProblemEntry `json:"problems"`
}

type ProblemEntry struct {
	LectureID    int64  `json:"lecture_id"`
	ProblemID    int64  `json:"problem_id"`
	RegisteredAt int64  `json:"registered_at"`
	Title        string `json:"title"`
}

func FetchLectureEntry(ctx context.Context, problemStore database.ProblemStore, filter bool) ([]LectureEntry, error) {
	lectures, err := problemStore.GetAllLectureAndProblems(ctx)
	if err != nil {
		return nil, err
	}

	var lectureEntries []LectureEntry
	for _, lecture := range lectures {
		// If filter is true, filter out lectures that are not yet published.
		if filter && lecture.StartDate.After(time.Now()) {
			continue
		}

		lectureEntry := LectureEntry{
			LectureID: lecture.ID,
			Title:     lecture.Title,
			StartDate: lecture.StartDate.Unix(),
			Deadline:  lecture.Deadline.Unix(),
			Problems:  []ProblemEntry{},
		}

		for _, problem := range lecture.Problems {
			problemEntry := ProblemEntry{
				LectureID:    problem.LectureID,
				ProblemID:    problem.ProblemID,
				Title:        problem.Title,
				RegisteredAt: problem.RegisteredAt.Unix(),
			}
			lectureEntry.Problems = append(lectureEntry.Problems, problemEntry)
		}
		lectureEntries = append(lectureEntries, lectureEntry)
	}
	return lectureEntries, nil
}

func FetchLectureByID(ctx context.Context, problemStore database.ProblemStore, lectureID int64, filter bool) (*LectureEntry, error) {
	lecture, err := problemStore.GetLectureAndAllProblems(ctx, lectureID)
	if err != nil {
		return nil, err
	}

	// If filter is true, and the lecture is unpublished, return nil
	if filter && lecture.StartDate.After(time.Now()) {
		return nil, errors.New("lecture is not published")
	}
	lectureEntry := LectureEntry{
		LectureID: lecture.ID,
		Title:     lecture.Title,
		StartDate: lecture.StartDate.Unix(),
		Deadline:  lecture.Deadline.Unix(),
		Problems:  []ProblemEntry{},
	}

	for _, problem := range lecture.Problems {
		problemEntry := ProblemEntry{
			LectureID:    problem.LectureID,
			ProblemID:    problem.ProblemID,
			Title:        problem.Title,
			RegisteredAt: problem.RegisteredAt.Unix(),
		}
		lectureEntry.Problems = append(lectureEntry.Problems, problemEntry)
	}

	// sort problems by ProblemID to make output deterministic
	// because currently, bun does not guarantee the order of "has-many" relations
	slices.SortFunc(lectureEntry.Problems, func(a, b ProblemEntry) int {
		return int(a.ProblemID - b.ProblemID)
	})

	return &lectureEntry, nil
}

type ProblemDetail struct {
	LectureID     int64      `json:"lecture_id"`
	ProblemID     int64      `json:"problem_id"`
	Title         string     `json:"title"`
	Description   string     `json:"description"`
	TimeMS        int64      `json:"time_ms"`
	MemoryMB      int64      `json:"memory_mb"`
	TestFiles     []FileData `json:"test_files"`
	RequiredFiles []string   `json:"required_files"`
}

func FetchProblemDetail(ctx context.Context, problemStore database.ProblemStore, fileStore database.FileStore, lectureID int64, problemID int64, filter bool) (*ProblemDetail, error) {
	// fetch lecture
	lecture, err := problemStore.GetLectureByID(ctx, lectureID)
	if err != nil {
		return nil, err
	}

	// If filter is true, and the lecture is unpublished, return nil
	if filter && lecture.StartDate.After(time.Now()) {
		return nil, errors.New("lecture is not published")
	}

	// fetch problem
	problem, err := problemStore.GetProblemByID(ctx, lectureID, problemID)
	if err != nil {
		return nil, err
	}

	// read description md file
	fileLocation, err := fileStore.GetFileLocation(ctx, problem.ResourceLocationID)
	if err != nil {
		return nil, err
	}

	filePath := filepath.Join(fileLocation.Path, problem.Detail.DescriptionPath)

	// read file
	mdContent, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	detail := ProblemDetail{
		LectureID:     problem.LectureID,
		ProblemID:     problem.ProblemID,
		Title:         problem.Title,
		Description:   string(mdContent),
		TimeMS:        problem.Detail.TimeMS,
		MemoryMB:      problem.Detail.MemoryMB,
		RequiredFiles: problem.Detail.RequiredFiles,
	}

	// fetch test files
	for _, testFile := range problem.Detail.TestFiles {
		filePath := filepath.Join(fileLocation.Path, testFile)
		fileData, err := FetchFile(filePath)
		if err != nil {
			return nil, err
		}
		fileData.Name = testFile
		detail.TestFiles = append(detail.TestFiles, *fileData)
	}

	return &detail, nil
}

func FetchTestFielsInProblem(ctx context.Context, problemStore database.ProblemStore, lectureID int64, problemID int64) ([]FileData, error) {
	// fetch problem info
	problem, err := problemStore.GetProblemByID(ctx, lectureID, problemID)
	if err != nil {
		return nil, err
	}

	// fetch resource resource_dir
	resource_dir, err := problemStore.FetchResourcePath(ctx, lectureID, problemID)
	if err != nil {
		return nil, err
	}

	var testFiles []FileData
	for _, testFile := range problem.Detail.TestFiles {
		filePath := filepath.Join(resource_dir, testFile)
		fileData, err := FetchFile(filePath)
		if err != nil {
			return nil, err
		}
		fileData.Name = testFile
		testFiles = append(testFiles, *fileData)
	}
	return testFiles, nil
}
