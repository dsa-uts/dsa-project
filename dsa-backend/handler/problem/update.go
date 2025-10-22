package problem

import (
	"context"
	"dsa-backend/fileutil"
	"dsa-backend/handler/response"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/dsa-uts/dsa-project/database/model"
	"github.com/labstack/echo/v4"
	"github.com/spf13/afero"
)

type LectureEntryRequest struct {
	ID        int64  `json:"id" validate:"required" default:"0"`
	Title     string `json:"title" validate:"required"`
	StartDate int64  `json:"start_date" validate:"required"`
	Deadline  int64  `json:"deadline" validate:"required"`
}

func (le *LectureEntryRequest) bind(c echo.Context) error {
	if err := c.Bind(le); err != nil {
		return err
	}
	if err := c.Validate(le); err != nil {
		return err
	}
	return nil
}

type LectureResponse struct {
	ID        int64     `json:"id"`
	Title     string    `json:"title"`
	StartDate time.Time `json:"start_date"`
	Deadline  time.Time `json:"deadline"`
}

type ProblemResponse struct {
	LectureID int64  `json:"lecture_id"`
	ProblemID int64  `json:"problem_id"`
	Title     string `json:"title"`
}

// CreateLectureEntry godoc
//
//	@Summary		Create a new lecture entry
//	@Description	Create a new lecture entry, accessible by manager and admin.
//	@Tags			Update
//	@Accept			json
//	@Produce		json
//	@param			lectureEntry	body		LectureEntryRequest	true	"Lecture entry details"
//	@Success		200				{object}	response.Success	"Lecture entry created successfully"
//	@Failure		400				{object}	response.Error		"Invalid request"
//	@Failure		500				{object}	response.Error		"Internal server error"
//	@Security		OAuth2Password[grading]
//	@Router			/problem/crud/create [put]
func (h *Handler) CreateLectureEntry(c echo.Context) error {
	lectureEntry := &LectureEntryRequest{}
	if err := lectureEntry.bind(c); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("invalid request: "+err.Error()))
	}
	ctx := context.Background()

	// Check existence of Lecture entry
	{
		_, err := h.problemStore.GetLectureByID(ctx, lectureEntry.ID)
		if err == nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("lecture entry already exists"))
		}
	}

	err := h.problemStore.CreateLectureEntry(ctx, &model.Lecture{
		ID:        lectureEntry.ID,
		Title:     lectureEntry.Title,
		StartDate: time.Unix(lectureEntry.StartDate, 0),
		Deadline:  time.Unix(lectureEntry.Deadline, 0),
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, response.NewError("failed to create lecture entry: "+err.Error()))
	}

	return c.JSON(http.StatusOK, response.NewSuccess("Lecture entry created successfully"))
}

// UpdateLectureEntry godoc
//
//	@Summary		Update an existing lecture entry
//	@Description	Update an existing lecture entry, accessible by manager and admin.
//	@Tags			Update
//	@Accept			json
//	@Produce		json
//	@Param			lectureid		path		int					true	"Lecture ID"
//	@Param			lectureEntry	body		LectureEntryRequest	true	"Lecture entry details"
//	@Success		200				{object}	response.Success	"Lecture entry updated successfully"
//	@Failure		400				{object}	response.Error		"Invalid request"
//	@Failure		500				{object}	response.Error		"Internal server error"
//	@Security		OAuth2Password[grading]
//	@Router			/problem/crud/update/{lectureid} [patch]
func (h *Handler) UpdateLectureEntry(c echo.Context) error {
	// Get lectureId from path param :lectureid, then convert to int
	lectureId, err := strconv.Atoi(c.Param("lectureid"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("invalid lecture ID"))
	}

	// Check the existence of lecture entry
	ctx := context.Background()
	lectureEntryInDB, err := h.problemStore.GetLectureByID(ctx, int64(lectureId))
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to get lecture entry: "+err.Error()))
	}

	lectureEntryRequest := &LectureEntryRequest{}
	if err := lectureEntryRequest.bind(c); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("invalid request: "+err.Error()))
	}

	lectureEntryInDB.Title = lectureEntryRequest.Title
	lectureEntryInDB.StartDate = time.Unix(lectureEntryRequest.StartDate, 0)
	lectureEntryInDB.Deadline = time.Unix(lectureEntryRequest.Deadline, 0)

	err = h.problemStore.UpdateLectureEntry(ctx, &lectureEntryInDB)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to update lecture entry: "+err.Error()))
	}

	return c.JSON(http.StatusOK, response.NewSuccess("Lecture entry updated successfully"))
}

// DeleteLectureEntry godoc
//
//	@Summary		Delete an existing lecture entry
//	@Description	Delete an existing lecture entry, accessible by manager and admin.
//	@Tags			Update
//	@Accept			json
//	@Produce		json
//	@Param			lectureid	path		int					true	"Lecture ID"
//	@Success		200			{object}	response.Success	"Lecture entry deleted successfully"
//	@Failure		400			{object}	response.Error		"Invalid request"
//	@Failure		500			{object}	response.Error		"Internal server error"
//	@Security		OAuth2Password[grading]
//	@Router			/problem/crud/delete/{lectureid} [delete]
func (h *Handler) DeleteLectureEntry(c echo.Context) error {
	// Get lectureId from path param :lectureid, then convert to int
	lectureId, err := strconv.Atoi(c.Param("lectureid"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("invalid lecture ID"))
	}

	// Check the existence of lecture entry
	ctx := context.Background()
	_, err = h.problemStore.GetLectureByID(ctx, int64(lectureId))
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to get lecture entry: "+err.Error()))
	}

	err = h.problemStore.DeleteLectureEntry(ctx, int64(lectureId))
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to delete lecture entry: "+err.Error()))
	}

	return c.JSON(http.StatusOK, response.NewSuccess("Lecture entry deleted successfully"))
}

type LectureIDProblemID struct {
	LectureID int64 `param:"lectureid"`
	ProblemID int64 `param:"problemid"`
}

// RegisterProblem godoc
//
//	@Summary		Register a new problem
//	@Description	Register a new problem associated with a lecture
//	@Tags			Update
//	@Accept			multipart/form-data
//	@Produce		json
//	@Param			lectureid	path		int					true	"Lecture ID"
//	@Param			problemid	path		int					true	"Problem ID"
//	@Param			file		formData	file				true	"Zip file contains problem resources"
//	@Success		200			{object}	response.Success	"Problem registered successfully"
//	@Failure		400			{object}	response.Error		"Invalid request"
//	@Failure		500			{object}	response.Error		"Internal server error"
//	@Security		OAuth2Password[grading]
//	@Router			/problem/crud/create/{lectureid}/{problemid} [post]
func (h *Handler) RegisterProblem(c echo.Context) error {
	var req LectureIDProblemID
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("invalid request: "+err.Error()))
	}

	context := context.Background()

	// Check the existence of problem entry
	exists, err := h.problemStore.CheckProblemExists(context, req.LectureID, req.ProblemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to check problem existence: "+err.Error()))
	}
	if exists {
		return echo.NewHTTPError(http.StatusNotFound, response.NewError("problem already exists"))
	}

	// Read zip file
	zipFile, err := c.FormFile("file")
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("failed to read file: "+err.Error()))
	}
	src, err := zipFile.Open()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to open file: "+err.Error()))
	}
	defer src.Close()

	// Create temporary in-memory fs
	memFs := afero.NewMemMapFs()

	// Extract zip file to temporary fs
	if err = fileutil.SafeExtractZip(memFs, src, zipFile.Size, "/"); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to unzip file: "+err.Error()))
	}

	// Check if the first level contains only one folder
	baseDirInMemFs := "/"
	files, err := afero.ReadDir(memFs, baseDirInMemFs)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to read extracted directory: "+err.Error()))
	}

	if len(files) == 1 && files[0].IsDir() {
		// Unnest the folder
		baseDirInMemFs = filepath.Join("/", files[0].Name())
	}

	// Check if init.json exists
	initPath := filepath.Join(baseDirInMemFs, "init.json")
	if stat, err := memFs.Stat(initPath); os.IsNotExist(err) || stat.IsDir() {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("init.json not found or is a directory"))
	}

	// Parse init.json into AssignmentConfig
	initFile, err := memFs.Open(initPath)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to open init.json: "+err.Error()))
	}
	defer initFile.Close()

	initData, err := afero.ReadAll(initFile)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to read init.json: "+err.Error()))
	}

	var config AssignmentConfig = AssignmentConfig{}
	if err := config.Decode(initData); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to parse init.json: "+err.Error()))
	}

	// Validate config
	// 1. Check MDfile exists
	// 2. Check test files exists
	// 3. Check Stdin, Stdout, Stderr files in test cases exist (if not empty)
	{
		// Check MDfile exists and is a file
		mdFilePath := filepath.Join(baseDirInMemFs, config.MDfile)
		if stat, err := os.Stat(mdFilePath); os.IsNotExist(err) || stat.IsDir() {
			return echo.NewHTTPError(http.StatusBadRequest, response.NewError("md_file not found or is a directory: "+config.MDfile))
		}

		// Check test files exist and are files
		for _, testFile := range config.TestFiles {
			testFilePath := filepath.Join(baseDirInMemFs, testFile)
			if stat, err := os.Stat(testFilePath); os.IsNotExist(err) || stat.IsDir() {
				return echo.NewHTTPError(http.StatusBadRequest, response.NewError("test file not found or is a directory: "+testFile))
			}
		}

		allTasks := append(config.Build, config.Judge...)

		// Check Stdin, Stdout, Stderr files in tasks
		for _, t := range allTasks {
			if t.Stdin != "" {
				stdinPath := filepath.Join(baseDirInMemFs, t.Stdin)
				if stat, err := os.Stat(stdinPath); os.IsNotExist(err) || stat.IsDir() {
					return echo.NewHTTPError(http.StatusBadRequest, response.NewError("stdin file not found or is a directory: "+t.Stdin))
				}
			}
			if t.Stdout != "" {
				stdoutPath := filepath.Join(baseDirInMemFs, t.Stdout)
				if stat, err := os.Stat(stdoutPath); os.IsNotExist(err) || stat.IsDir() {
					return echo.NewHTTPError(http.StatusBadRequest, response.NewError("stdout file not found or is a directory: "+t.Stdout))
				}
			}
			if t.Stderr != "" {
				stderrPath := filepath.Join(baseDirInMemFs, t.Stderr)
				if stat, err := os.Stat(stderrPath); os.IsNotExist(err) || stat.IsDir() {
					return echo.NewHTTPError(http.StatusBadRequest, response.NewError("stderr file not found or is a directory: "+t.Stderr))
				}
			}
		}
	}

	// TODO: parse readme, and capture every link referencing image file in this zip file.
	// e.g., [image1.png](image1.png)
	// After that, we need to do those tasks below:
	// 1. Register referenced file into FileReference Table.
	// 2. Convert image links to use the new file reference URLs.
	// e.g., Convert ![image1.png](image1.png) to ![image1.png](<base_url>/fileref/<id>)

	// Set the destination directory
	timestamp := time.Now().Format("2006-01-02T15-04-05")
	lectureIDstr := strconv.FormatInt(req.LectureID, 10)
	problemIDstr := strconv.FormatInt(req.ProblemID, 10)
	// ---------------------------------------------------------------------------
	// destDir: upload/resource/{lectureID}/{problemID}/{YYYY-MM-DD-HH-mm-ss}/
	// ---------------------------------------------------------------------------
	destDir := filepath.Join(RESOURCE_DIR, lectureIDstr, problemIDstr, timestamp)
	absDestDir, err := filepath.Abs(destDir)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to get absolute path of destination directory: "+err.Error()))
	}

	// Check if the destination directory already exists
	if info, err := os.Stat(destDir); err != nil {
		if os.IsNotExist(err) {
			// Directory does not exist, which is expected
		} else if info.IsDir() {
			// Directory already exists
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("destination directory already exists: "+destDir))
		} else {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to check upload directory"))
		}
	}

	// Make destination directory
	if err := os.MkdirAll(absDestDir, 0755); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to create destination directory: "+err.Error()))
	}

	osFs := afero.NewOsFs()
	// restrict access to destDir only, cannot access outside of it
	jailedFs := afero.NewBasePathFs(osFs, absDestDir)

	// Copy contents from in-memory fs to destination directory
	err = fileutil.CopyContentsBetweenAferoFs(memFs, baseDirInMemFs, jailedFs, "/")
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to copy files to destination directory: "+err.Error()))
	}

	// Register file location
	fileLocation := model.FileLocation{
		Path: destDir,
		Ts:   time.Now(),
	}
	err = h.fileStore.RegisterFileLocation(context, &fileLocation)

	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to register file location: "+err.Error()))
	}

	var buildtasks []model.TestCase
	var judgeTasks []model.TestCase

	for i, t := range config.Build {
		testcase := model.TestCase{
			ID:          int64(i + 1),
			Title:       t.Title,
			Description: t.Description,
			Command:     t.Command,
			Evaluation:  *t.EvalOnly,
			StdinPath:   t.Stdin,
			StdoutPath:  t.Stdout,
			StderrPath:  t.Stderr,
			ExitCode:    *t.ExitCode,
		}
		buildtasks = append(buildtasks, testcase)
	}

	for i, t := range config.Judge {
		testcase := model.TestCase{
			ID:          int64(i + 1),
			Title:       t.Title,
			Description: t.Description,
			Command:     t.Command,
			Evaluation:  *t.EvalOnly,
			StdinPath:   t.Stdin,
			StdoutPath:  t.Stdout,
			StderrPath:  t.Stderr,
			ExitCode:    *t.ExitCode,
		}
		judgeTasks = append(judgeTasks, testcase)
	}

	detail := model.Detail{
		DescriptionPath: config.MDfile,
		TimeMS:          *config.TimeMS,
		MemoryMB:        *config.MemoryMB,
		TestFiles:       config.TestFiles,
		RequiredFiles:   config.RequiredFiles,
		BuildTasks:      buildtasks,
		JudgeTasks:      judgeTasks,
	}

	problem := &model.Problem{
		LectureID:          req.LectureID,
		ProblemID:          req.ProblemID,
		RegisteredAt:       time.Now(),
		Title:              config.Title,
		ResourceLocationID: fileLocation.ID,
		Detail:             detail,
	}

	err = h.problemStore.RegisterProblem(context, problem)

	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to register problem: "+err.Error()))
	}

	return c.JSON(http.StatusOK, response.NewSuccess("Problem registered successfully"))
}

// DeleteProblem godoc
//
//	@Summary		delete problem entry
//	@Description	delete a problem entry by lecture ID and problem ID
//	@Tags			Update
//	@Accept			json
//	@Produce		json
//	@Param			lectureid	path		int					true	"Lecture ID"
//	@Param			problemid	path		int					true	"Problem ID"
//	@Success		200			{object}	response.Success	"Problem deleted successfully"
//	@Failure		400			{object}	response.Error		"Invalid request"
//	@Failure		404			{object}	response.Error		"Problem not found"
//	@Failure		500			{object}	response.Error		"Internal server error"
//	@Security		OAuth2Password[grading]
//	@Router			/problem/crud/delete/{lectureid}/{problemid} [delete]
func (h *Handler) DeleteProblem(c echo.Context) error {
	var req LectureIDProblemID
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("invalid request: "+err.Error()))
	}

	ctx := context.Background()

	// Check if corresponding problem data exists
	exists, err := h.problemStore.CheckProblemExists(ctx, req.LectureID, req.ProblemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to check problem existence: "+err.Error()))
	}
	if !exists {
		return echo.NewHTTPError(http.StatusNotFound, response.NewError("problem not found"))
	}

	err = h.problemStore.DeleteProblem(ctx, req.LectureID, req.ProblemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to delete problem: "+err.Error()))
	}

	return c.JSON(http.StatusOK, response.NewSuccess("Problem deleted successfully"))
}
