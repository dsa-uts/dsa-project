package problem

import (
	"context"
	"dsa-backend/handler/auth"
	"dsa-backend/handler/problem/util"
	"dsa-backend/handler/response"
	"fmt"
	"net/http"
	"path/filepath"
	"slices"
	"time"

	"github.com/dsa-uts/dsa-project/database"
	"github.com/dsa-uts/dsa-project/database/model"
	"github.com/labstack/echo/v4"
)

type ListingProps struct {
	Anchor    int64  `query:"anchor" validate:"min=0" default:"15000000"`
	Direction string `query:"direction" validate:"omitempty,oneof=next prev" default:"next"`
}

type ListingOutput struct {
	Results     []ValidationResult  `json:"results"`
	LectureInfo []util.LectureEntry `json:"lecture_info"`
}

type ValidationResult struct {
	ID        int64  `json:"id"`
	TS        int64  `json:"ts"`
	UserID    string `json:"user_id"`
	UserName  string `json:"user_name"`
	LectureID int64  `json:"lecture_id"`
	ProblemID int64  `json:"problem_id"`
	ResultID  int64  `json:"result_id"`
	TimeMS    int64  `json:"time_ms"`
	MemoryKB  int64  `json:"memory_kb"`
}

// ListValidationResults lists validation results (not detailed, just summary) for the current user.
//
//	@Summary		List Validation Results for Current User
//	@Description	List validation results (not detailed, just summary) for the current user.
//	@Tags			Result
//	@Produce		json
//	@Param			anchor		query		int64	false	"The anchor ID received in the previous request."													default(15000000)	minimum(0)
//	@Param			direction	query		string	false	"The direction to fetch results. Use 'next' to get older results and 'prev' to get newer results."	Enums(next, prev)	default(next)
//	@Success		200			{object}	ListingOutput
//	@Failure		400			{object}	response.Error	"Invalid request"
//	@Failure		401			{object}	response.Error	"Failed to get user info"
//	@Failure		500			{object}	response.Error	"Failed to get lecture entries"	"Failed to get validation results"
//	@Security		OAuth2Password[grading]
//	@Router			/problem/result/validation/list [get]
func (h *Handler) ListValidationResults(c echo.Context) error {
	var props ListingProps

	if err := c.Bind(&props); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid request"))
	}
	if err := c.Validate(&props); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid request"))
	}

	ctx := context.Background()

	// get user info from jwt
	claim, err := auth.GetJWTClaims(&c)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, response.NewError("Failed to get user info"))
	}

	userCode := claim.ID

	rightsToAccessAll := claim.HasAllScopes(auth.ScopeGrading) || claim.HasAllScopes(auth.ScopeAdmin)

	filter := false
	if !rightsToAccessAll {
		// if the user is not manager or admin, filter out unpublished lectures
		filter = true
	}

	if rightsToAccessAll {
		userCode = -1 // get all users' results
	}

	// get allowed lecture ids
	lectureEntries, err := util.FetchLectureEntry(ctx, h.problemStore, filter)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get lecture entries"))
	}

	var allowedLectureIDs []int64
	for _, entry := range lectureEntries {
		allowedLectureIDs = append(allowedLectureIDs, entry.LectureID)
	}

	// get validation results
	results, err := h.requestStore.GetValidationResults(ctx, userCode, allowedLectureIDs, props.Anchor, 20, database.Direction(props.Direction))
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get validation results"))
	}

	// sort results by ID descending to make output deterministic
	slices.SortFunc(results, func(a, b model.ValidationRequest) int {
		return int(b.ID - a.ID)
	})

	var outputResults []ValidationResult
	for _, result := range results {
		outputResults = append(outputResults, ValidationResult{
			ID:        result.ID,
			TS:        result.TS.Unix(),
			UserID:    result.User.UserID,
			UserName:  result.User.Name,
			LectureID: result.LectureID,
			ProblemID: result.ProblemID,
			ResultID:  int64(result.ResultID),
			TimeMS:    result.Log.TimeMS,
			MemoryKB:  result.Log.MemoryKB,
		})
	}

	return c.JSON(http.StatusOK, ListingOutput{
		Results:     outputResults,
		LectureInfo: lectureEntries,
	})
}

type ValidationResultProps struct {
	ID int64 `param:"id" validate:"required,min=1"`
}

// GetValidationResult gets summary information about a specific validation result.
//
//	@Summary		Get Validation Result Summary
//	@Description	Get summary information about a specific validation result.
//	@Tags			Result
//	@Produce		json
//	@Param			id	path		int64	true	"Validation Result ID"
//	@Success		200	{object}	ValidationResult
//	@Failure		400	{object}	response.Error	"Invalid request"
//	@Failure		401	{object}	response.Error	"Failed to get user info"
//	@Failure		404	{object}	response.Error	"Validation result not found"
//	@Failure		500	{object}	response.Error	"Failed to get validation result"
//	@Security		OAuth2Password[me]
//	@Router			/problem/result/validation/{id} [get]
func (h *Handler) GetValidationResult(c echo.Context) error {
	var props ValidationResultProps
	if err := c.Bind(&props); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid request"))
	}

	if err := c.Validate(&props); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid request"))
	}

	ctx := context.Background()

	// get user info from jwt
	claim, err := auth.GetJWTClaims(&c)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, response.NewError("Failed to get user info"))
	}

	userCode := claim.ID

	rightsToAccessAll := claim.HasAllScopes(auth.ScopeGrading) || claim.HasAllScopes(auth.ScopeAdmin)
	validationRequest, err := h.requestStore.GetValidationResultByID(ctx, props.ID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get validation result"))
	}

	if validationRequest == nil {
		return echo.NewHTTPError(http.StatusNotFound, response.NewError("Validation result not found"))
	}

	// when the user is not admin or manager, check if the user is the owner of the request
	if !rightsToAccessAll && validationRequest.UserCode != userCode {
		return echo.NewHTTPError(http.StatusNotFound, response.NewError("Validation result not found"))
	}

	return c.JSON(http.StatusOK, ValidationResult{
		ID:        validationRequest.ID,
		TS:        validationRequest.TS.Unix(),
		UserID:    validationRequest.User.UserID,
		UserName:  validationRequest.User.Name,
		LectureID: validationRequest.LectureID,
		ProblemID: validationRequest.ProblemID,
		ResultID:  int64(validationRequest.ResultID),
		TimeMS:    validationRequest.Log.TimeMS,
		MemoryKB:  validationRequest.Log.MemoryKB,
	})
}

type ValidationDetailProps struct {
	ID int64 `param:"id" validate:"required,min=1"`
}

type DetailOutput struct {
	ID            int64             `json:"id"`
	TS            int64             `json:"ts"`
	UserID        string            `json:"user_id"`
	UserName      string            `json:"user_name"`
	LectureID     int64             `json:"lecture_id"`
	ProblemID     int64             `json:"problem_id"`
	LectureTitle  string            `json:"lecture_title"`
	ProblemTitle  string            `json:"problem_title"`
	SubmissionTS  int64             `json:"submission_ts"`
	ResultID      int64             `json:"result_id"`
	TimeMS        int64             `json:"time_ms"`
	MemoryKB      int64             `json:"memory_kb"`
	UploadedFiles []util.FileData   `json:"uploaded_files"`
	TestFiles     []util.FileData   `json:"test_files"`
	BuildLogs     []DetailedTaskLog `json:"build_logs"`
	JudgeLogs     []DetailedTaskLog `json:"judge_logs"`
}

type DetailedTaskLog struct {
	TestCaseID       int64   `json:"test_case_id"`
	Description      string  `json:"description"`
	Command          string  `json:"command"`
	ResultID         int64   `json:"result_id"`
	TimeMS           int64   `json:"time_ms"`
	MemoryKB         int64   `json:"memory_kb"`
	ExitCode         int64   `json:"exit_code"`
	ExpectedExitCode int64   `json:"expected_exit_code"`
	Stdin            *string `json:"stdin"`           // base64 encoded, compressed with gzip
	Stdout           string  `json:"stdout"`          // base64 encoded, compressed with gzip
	Stderr           string  `json:"stderr"`          // base64 encoded, compressed with gzip
	ExpectedStdout   *string `json:"expected_stdout"` // base64 encoded, compressed with gzip
	ExpectedStderr   *string `json:"expected_stderr"` // base64 encoded, compressed with gzip
}

// GetValidationDetail gets detailed information about a specific validation result.
//
//	@Summary		Get Validation Result Detail
//	@Description	Get detailed information about a specific validation result.
//	@Tags			Result
//	@Produce		json
//	@Param			id	path		int64	true	"Validation Result ID"
//	@Success		200	{object}	DetailOutput
//	@Failure		400	{object}	response.Error	"Invalid request"
//	@Failure		401	{object}	response.Error	"Failed to get user info"
//	@Failure		404	{object}	response.Error	"Validation result not found"
//	@Failure		500	{object}	response.Error	"Failed to get validation result"	"File location not found"	"Failed to fetch uploaded files"	"Failed to read build stdout"	"Failed to read build stderr"	"Failed to read judge stdout"	"Failed to read judge stderr"
//	@Security		OAuth2Password[me]
//	@Router			/problem/result/validation/detail/{id} [get]
func (h *Handler) GetValidationDetail(c echo.Context) error {
	var props ValidationDetailProps
	if err := c.Bind(&props); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid request"))
	}

	if err := c.Validate(&props); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid request"))
	}

	// Get user info from jwt
	claim, err := auth.GetJWTClaims(&c)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, response.NewError("Failed to get user info"))
	}

	ctx := context.Background()

	validationRequest, err := h.requestStore.GetValidationResultByID(ctx, props.ID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get validation result"))
	}
	if validationRequest == nil {
		return echo.NewHTTPError(http.StatusNotFound, response.NewError("Validation result not found"))
	}

	// When the user is not admin or manager, check if the user is the owner of the request
	rightsToAccessAll := claim.HasAllScopes(auth.ScopeGrading) || claim.HasAllScopes(auth.ScopeAdmin)
	if !rightsToAccessAll && validationRequest.UserCode != claim.ID {
		return echo.NewHTTPError(http.StatusNotFound, response.NewError("Validation result not found"))
	}

	// Fetch lecture info
	lecture_info, err := h.problemStore.GetLectureByID(ctx, validationRequest.LectureID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get lecture info"))
	}

	// When the user is not admin or manager, check if the lecture is published
	if !rightsToAccessAll && lecture_info.StartDate.After(time.Now()) {
		return echo.NewHTTPError(http.StatusNotFound, response.NewError("Validation result not found"))
	}

	// Fetch problem info to get test case info and test files.
	problem_info, err := h.problemStore.GetProblemByID(ctx, validationRequest.LectureID, validationRequest.ProblemID)

	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get problem info"))
	}

	detail := DetailOutput{
		ID:           validationRequest.ID,
		TS:           validationRequest.TS.Unix(),
		UserID:       validationRequest.User.UserID,
		UserName:     validationRequest.User.Name,
		LectureID:    validationRequest.LectureID,
		ProblemID:    validationRequest.ProblemID,
		LectureTitle: lecture_info.Title,
		ProblemTitle: problem_info.Title,
		SubmissionTS: validationRequest.TS.Unix(), // for validation request, submission ts is same as request ts
		ResultID:     int64(validationRequest.ResultID),
		TimeMS:       validationRequest.Log.TimeMS,
		MemoryKB:     validationRequest.Log.MemoryKB,
		// Fill in UploadedFiles later
		// NOTE: initialize with empty slice to avoid null encoding in JSON
		UploadedFiles: []util.FileData{},
		// Fill in TestFiles later
		TestFiles: []util.FileData{},
		// Fill in BuildLogs later
		BuildLogs: []DetailedTaskLog{},
		// Fill in JudgeLogs later
		JudgeLogs: []DetailedTaskLog{},
	}

	// Fill in uploaded files
	if validationRequest.FileLocation == nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("File location not found"))
	}

	uploadDirPath := validationRequest.FileLocation.Path

	fileDataList, err := util.FetchAllFilesInDirectory(uploadDirPath)

	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to fetch uploaded files"))
	}

	detail.UploadedFiles = fileDataList

	resource_dir, err := h.problemStore.FetchResourcePath(ctx, validationRequest.LectureID, validationRequest.ProblemID)

	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get problem info"))
	}

	buildTaskDict := make(map[int64]model.TestCase)
	for _, task := range problem_info.Detail.BuildTasks {
		buildTaskDict[task.ID] = task
	}
	judgeTaskDict := make(map[int64]model.TestCase)
	for _, task := range problem_info.Detail.JudgeTasks {
		judgeTaskDict[task.ID] = task
	}

	// Fill in test files
	testFiles, err := util.FetchTestFielsInProblem(ctx, h.problemStore, validationRequest.LectureID, validationRequest.ProblemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get problem info"))
	}
	detail.TestFiles = testFiles

	// Fill in build logs
	for _, buildResult := range validationRequest.Log.BuildResults {
		corresponding_task, exists := buildTaskDict[buildResult.TestCaseID]
		if !exists {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Inconsistent data: build task not found"))
		}

		detailedTaskLog, err := makeDetailedTaskLog(buildResult, corresponding_task, resource_dir)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to create detailed task log: "+err.Error()))
		}

		detail.BuildLogs = append(detail.BuildLogs, detailedTaskLog)
	}

	// Fill in judge logs
	for _, judgeResult := range validationRequest.Log.JudgeResults {

		corresponding_task, exists := judgeTaskDict[judgeResult.TestCaseID]
		if !exists {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Inconsistent data: judge task not found"))
		}

		detailedTaskLog, err := makeDetailedTaskLog(judgeResult, corresponding_task, resource_dir)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to create detailed task log: "+err.Error()))
		}

		detail.JudgeLogs = append(detail.JudgeLogs, detailedTaskLog)
	}

	return c.JSON(http.StatusOK, detail)
}

type GradingListProps struct {
	LectureID int64 `param:"lectureid"`
}

type GradingListOutput struct {
	LectureInfo util.LectureEntry   `json:"lecture_info"`
	Detail      []UserGradingResult `json:"detail"`
}

type UserGradingResult struct {
	UserID   string                    `json:"user_id"`
	UserName string                    `json:"user_name"`
	Results  []GradingResultPerProblem `json:"results"`
}

type GradingResultPerProblem struct {
	ID           int64 `json:"id"`
	ProblemID    int64 `json:"problem_id"`
	ResultID     int64 `json:"result_id"`
	SubmissionTS int64 `json:"submission_ts"`
	TimeMS       int64 `json:"time_ms"`
	MemoryKB     int64 `json:"memory_kb"`
}

// ListGradingResults lists grading results for a specific lecture.
//
//	@Summary		List Grading Results for a Specific Lecture
//	@Description	List grading results for a specific lecture.
//	@Tags			Result
//	@Produce		json
//	@Param			lectureid	path		int64	true	"The ID of the lecture to retrieve grading results for."
//	@Success		200			{object}	GradingListOutput
//	@Failure		400			{object}	response.Error	"Invalid request"	"No users found"
//	@Failure		401			{object}	response.Error	"Failed to get user info"
//	@Failure		500			{object}	response.Error	"Failed to get user list"	"Failed to get grading results"	"Failed to get lecture info"	"Inconsistent data: user not found"	"Inconsistent data: user not found in detail assembly"
//	@Security		OAuth2Password[grading]
//	@Router			/problem/result/grading/list/{lectureid} [get]
func (h *Handler) ListGradingResults(c echo.Context) error {
	var props GradingListProps
	ctx := context.Background()
	if err := c.Bind(&props); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid request"))
	}

	if err := c.Validate(&props); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid request"))
	}

	// Fetch all user lists
	userList, err := h.userStore.GetAllUserList(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get user list"))
	}
	if userList == nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("No users found"))
	}

	results, err := h.requestStore.GetGradingResults(ctx, props.LectureID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Failed to get grading results"))
	}

	// get lecture info
	lectureEntry, err := util.FetchLectureByID(ctx, h.problemStore, props.LectureID, false)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get lecture info"))
	}

	if lectureEntry == nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Lecture not found"))
	}

	output := GradingListOutput{
		LectureInfo: *lectureEntry,
	}

	// TODO: implement logic to fill in output.Detail
	gradingResultDict := make(map[int64]UserGradingResult)
	for _, user := range *userList {
		gradingResultDict[user.ID] = UserGradingResult{
			UserID:   user.UserID,
			UserName: user.Name,
			Results:  []GradingResultPerProblem{},
		}
	}

	for _, result := range results {
		userResult, exists := gradingResultDict[result.UserCode]
		if !exists {
			// This must not happen, so return error
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Inconsistent data: user not found"))
		}

		userResult.Results = append(userResult.Results, GradingResultPerProblem{
			ID:           result.ID,
			ProblemID:    result.ProblemID,
			ResultID:     int64(result.ResultID),
			SubmissionTS: result.SubmissionTS.Unix(),
			TimeMS:       result.Log.TimeMS,
			MemoryKB:     result.Log.MemoryKB,
		})

		gradingResultDict[result.UserCode] = userResult
	}

	keys := make([]int64, 0, len(*userList))
	for _, user := range *userList {
		keys = append(keys, user.ID)
	}

	// sort keys to make output deterministic
	slices.Sort(keys)

	detail := make([]UserGradingResult, 0, len(gradingResultDict))

	for _, k := range keys {
		if userResult, exists := gradingResultDict[k]; exists {
			// sort results by ProblemID and submission timestamp to make output deterministic
			slices.SortFunc(userResult.Results, func(a, b GradingResultPerProblem) int {
				if a.ProblemID != b.ProblemID {
					return int(a.ProblemID - b.ProblemID)
				}
				return int(a.SubmissionTS - b.SubmissionTS)
			})

			detail = append(detail, userResult)
		} else {
			// This must not happen, so return error
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Inconsistent data: user not found in detail assembly"))
		}
	}

	output.Detail = detail

	return c.JSON(http.StatusOK, output)
}

type GradingDetailProps struct {
	LectureID int64  `param:"lectureid"`
	UserID    string `param:"userid"`
}

type GradingDetailOutput struct {
	LectureID           int64                     `json:"lecture_id"`
	LectureInfo         util.LectureEntry         `json:"lecture_info"`
	UserID              string                    `json:"user_id"`
	UserName            string                    `json:"user_name"`
	FileGroups          []FileGroup               `json:"file_groups"`
	TestFilesPerProblem []TestFilesPerProblem     `json:"test_files_per_problem"`
	DetailList          []GradingDetailPerProblem `json:"detail_list"`
}

type GradingDetailPerProblem struct {
	ID              int64             `json:"id"`
	ProblemID       int64             `json:"problem_id"`
	RequestUserID   string            `json:"request_user_id"`
	RequestUserName string            `json:"request_user_name"`
	TS              int64             `json:"ts"`
	SubmissionTS    int64             `json:"submission_ts"`
	ResultID        int64             `json:"result_id"`
	FileGroupID     int64             `json:"file_group_id"`
	TimeMS          int64             `json:"time_ms"`
	MemoryKB        int64             `json:"memory_kb"`
	BuildLogs       []DetailedTaskLog `json:"build_logs"`
	JudgeLogs       []DetailedTaskLog `json:"judge_logs"`
}

type FileGroup struct {
	ID    int64           `json:"id"`
	Files []util.FileData `json:"files"`
}

type TestFilesPerProblem struct {
	ProblemID int64           `json:"problem_id"`
	Files     []util.FileData `json:"files"`
}

// GetGradingResult gets detailed information about a specific grading result.
//
//	@Summary		Get Grading Result Detail
//	@Description	Get detailed information about a specific grading result.
//	@Tags			Result
//	@Produce		json
//	@Param			lectureid	path		int64	true	"Lecture ID"
//	@Param			userid		path		string	true	"User ID"
//	@Success		200			{object}	GradingDetailOutput
//	@Failure		400			{object}	response.Error	"Invalid request"
//	@Failure		401			{object}	response.Error	"Failed to get user info"
//	@Failure		404			{object}	response.Error	"Grading result not found"
//	@Failure		500			{object}	response.Error	"Failed to get grading result"	"Failed to get lecture info"	"Failed to get problem info"	"Inconsistent data: user info missing"	"File location not found"	"Failed to fetch uploaded files"	"Failed to read build stdout"	"Failed to read build stderr"	"Failed to read judge stdout"	"Failed to read judge stderr"
//	@Security		OAuth2Password[grading]
//	@Router			/problem/result/grading/summary/{lectureid}/{userid} [get]
func (h *Handler) GetGradingResult(c echo.Context) error {
	var props GradingDetailProps
	ctx := context.Background()
	if err := c.Bind(&props); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid request"))
	}

	if err := c.Validate(&props); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid request"))
	}

	// Get user code from user ID
	user, err := h.userStore.GetUserByUserID(ctx, props.UserID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get user info"))
	}
	if user == nil {
		return echo.NewHTTPError(http.StatusNotFound, response.NewError("Grading result not found"))
	}
	userCode := user.ID

	// Get lecture and problem info
	lectureData, err := h.problemStore.GetLectureAndAllProblems(ctx, props.LectureID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get lecture info"))
	}

	// create lecture entry
	lectureEntry := util.LectureEntry{
		LectureID: lectureData.ID,
		Title:     lectureData.Title,
		StartDate: lectureData.StartDate.Unix(),
		Deadline:  lectureData.Deadline.Unix(),
		// NOTE: initialize with empty slice to avoid null encoding in JSON
		Problems: []util.ProblemEntry{},
	}

	for _, problem := range lectureData.Problems {
		lectureEntry.Problems = append(lectureEntry.Problems, util.ProblemEntry{
			LectureID:    problem.LectureID,
			ProblemID:    problem.ProblemID,
			RegisteredAt: problem.RegisteredAt.Unix(),
			Title:        problem.Title,
		})
	}

	problemDict := make(map[int64]model.Problem)
	for _, problem := range lectureData.Problems {
		problemDict[problem.ProblemID] = *problem
	}

	// Fetch resource paths for all problems
	resourceDirDict, err := h.problemStore.FetchAllResourceLocations(ctx, &props.LectureID, nil)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get problem info"))
	}

	grResults, err := h.requestStore.GetGradingResultsByLectureIDAndUserCode(ctx, props.LectureID, userCode)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get grading results"))
	}

	output := GradingDetailOutput{
		LectureID:   props.LectureID,
		LectureInfo: lectureEntry,
		UserID:      props.UserID,
		UserName:    user.Name,
		// TestFilesPerProblem to be filled later,
		// NOTE: initialize with empty slice to avoid null encoding in JSON
		TestFilesPerProblem: []TestFilesPerProblem{},
		// FileGroups to be filled later,
		FileGroups: []FileGroup{},
		// DetailList to be filled later
		DetailList: []GradingDetailPerProblem{},
	}

	// Fill in TestFilesPerProblem
	testFilesPerProblem := make([]TestFilesPerProblem, 0, len(lectureEntry.Problems))
	for _, problem := range lectureEntry.Problems {
		testFiles, err := util.FetchTestFielsInProblem(ctx, h.problemStore, problem.LectureID, problem.ProblemID)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get problem info"))
		}

		testFilesPerProblem = append(testFilesPerProblem, TestFilesPerProblem{
			ProblemID: problem.ProblemID,
			Files:     testFiles,
		})
	}
	output.TestFilesPerProblem = testFilesPerProblem

	fileGroupDict := make(map[int64]FileGroup)

	for _, grResult := range grResults {
		upload_dir_id := grResult.UploadDirID
		if _, exists := fileGroupDict[upload_dir_id]; exists {
			continue
		}

		fileDataList, err := util.FetchAllFilesInDirectory(grResult.FileLocation.Path)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to fetch uploaded files"))
		}

		fileGroupDict[upload_dir_id] = FileGroup{
			ID:    upload_dir_id,
			Files: fileDataList,
		}
	}

	// Fill in FileGroups
	file_groups := make([]FileGroup, 0, len(fileGroupDict))
	for _, fg := range fileGroupDict {
		file_groups = append(file_groups, fg)
	}
	output.FileGroups = file_groups

	// Fill in DetailList
	for _, grResult := range grResults {
		var problemData model.Problem
		problemData, exists := problemDict[grResult.ProblemID]
		if !exists {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get problem info"))
		}

		if grResult.RequestUser == nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Inconsistent data: user info missing"))
		}

		detail := GradingDetailPerProblem{
			ID:              grResult.ID,
			ProblemID:       grResult.ProblemID,
			RequestUserID:   grResult.RequestUser.UserID,
			RequestUserName: grResult.RequestUser.Name,
			TS:              grResult.TS.Unix(),
			SubmissionTS:    grResult.SubmissionTS.Unix(),
			ResultID:        int64(grResult.ResultID),
			FileGroupID:     grResult.UploadDirID,
			TimeMS:          grResult.Log.TimeMS,
			MemoryKB:        grResult.Log.MemoryKB,
			// BuildLogs to be filled later
			// NOTE: initialize with empty slice to avoid null encoding in JSON
			BuildLogs: []DetailedTaskLog{},
			// JudgeLogs to be filled later
			JudgeLogs: []DetailedTaskLog{},
		}

		buildTaskDict := make(map[int64]model.TestCase)
		for _, task := range problemData.Detail.BuildTasks {
			buildTaskDict[task.ID] = task
		}

		judgeTaskDict := make(map[int64]model.TestCase)
		for _, task := range problemData.Detail.JudgeTasks {
			judgeTaskDict[task.ID] = task
		}

		for _, buildResult := range grResult.Log.BuildResults {
			corresponding_task, exists := buildTaskDict[buildResult.TestCaseID]
			if !exists {
				return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Inconsistent data: build task not found"))
			}

			resource_dir, exists := resourceDirDict.Get(grResult.LectureID, grResult.ProblemID)
			if !exists {
				return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get problem info"))
			}

			detailedTaskLog, err := makeDetailedTaskLog(buildResult, corresponding_task, resource_dir)
			if err != nil {
				return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to create detailed task log: "+err.Error()))
			}

			detail.BuildLogs = append(detail.BuildLogs, detailedTaskLog)
		}

		for _, judgeResult := range grResult.Log.JudgeResults {
			corresponding_task, exists := judgeTaskDict[judgeResult.TestCaseID]
			if !exists {
				return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Inconsistent data: judge task not found"))
			}

			resource_dir, exists := resourceDirDict.Get(grResult.LectureID, grResult.ProblemID)
			if !exists {
				return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get problem info"))
			}

			detailedTaskLog, err := makeDetailedTaskLog(judgeResult, corresponding_task, resource_dir)
			if err != nil {
				return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to create detailed task log: "+err.Error()))
			}

			detail.JudgeLogs = append(detail.JudgeLogs, detailedTaskLog)
		}

		output.DetailList = append(output.DetailList, detail)
	}

	return c.JSON(http.StatusOK, output)
}

func makeDetailedTaskLog(taskResult model.TaskLog, testCase model.TestCase, resouce_dir string) (DetailedTaskLog, error) {
	var stdinData *string = nil

	if testCase.StdinPath != "" {
		// If StdinPath is specified, try to fetch the stdin file
		stdinPath := filepath.Join(resouce_dir, testCase.StdinPath)
		stdin, err := util.FetchFile(stdinPath)
		if err != nil {
			return DetailedTaskLog{}, fmt.Errorf("failed to read stdin: %w", err)
		}
		stdinData = &stdin.Data
	}

	stdout, err := util.FetchFile(taskResult.StdoutPath)
	if err != nil {
		return DetailedTaskLog{}, fmt.Errorf("failed to read stdout: %w", err)
	}
	stderr, err := util.FetchFile(taskResult.StderrPath)
	if err != nil {
		return DetailedTaskLog{}, fmt.Errorf("failed to read stderr: %w", err)
	}

	var expectedStdoutData *string = nil
	if testCase.StdoutPath != "" {
		stdoutPath := filepath.Join(resouce_dir, testCase.StdoutPath)
		expected_stdout, err := util.FetchFile(stdoutPath)
		if err != nil {
			return DetailedTaskLog{}, fmt.Errorf("failed to read expected stdout: %w", err)
		}
		expectedStdoutData = &expected_stdout.Data
	}

	var expectedStderrData *string = nil
	if testCase.StderrPath != "" {
		stderrPath := filepath.Join(resouce_dir, testCase.StderrPath)
		expected_stderr, err := util.FetchFile(stderrPath)
		if err != nil {
			return DetailedTaskLog{}, fmt.Errorf("failed to read expected stderr: %w", err)
		}
		expectedStderrData = &expected_stderr.Data
	}

	return DetailedTaskLog{
		TestCaseID:       taskResult.TestCaseID,
		Description:      testCase.Description,
		Command:          testCase.Command,
		ResultID:         int64(taskResult.ResultID),
		TimeMS:           taskResult.TimeMS,
		MemoryKB:         taskResult.MemoryKB,
		ExitCode:         taskResult.ExitCode,
		ExpectedExitCode: testCase.ExitCode,
		Stdin:            stdinData,
		Stdout:           stdout.Data,
		Stderr:           stderr.Data,
		ExpectedStdout:   expectedStdoutData,
		ExpectedStderr:   expectedStderrData,
	}, nil
}
