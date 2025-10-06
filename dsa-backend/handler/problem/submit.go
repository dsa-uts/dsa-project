package problem

import (
	"context"
	"dsa-backend/fileutil"
	"dsa-backend/handler/auth"
	"dsa-backend/handler/response"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dsa-uts/dsa-project/database/model"
	"github.com/dsa-uts/dsa-project/database/model/queuestatus"
	"github.com/dsa-uts/dsa-project/database/model/queuetype"
	"github.com/dsa-uts/dsa-project/database/model/requeststatus"
	"github.com/labstack/echo/v4"
)

// TODO: Discuss file size limits
// TODO: Make this configuration be configurable via env file, or admin API.
const (
	// Maximum uncompressed size for uploaded files (10MB)
	maxUncompressedSize = 10 * 1024 * 1024
	// Maximum size for a single uploaded file (5MB)
	maxFileSize = 5 * 1024 * 1024
	// Maximum size for an uploaded zip file (5MB)
	maxZipSize = 5 * 1024 * 1024
)

// RequestValidation godoc
//
//	@Summary		Request validation
//	@Description	request a validation request, which is just compiling program codes, and executes some simple test cases.
//	@Tags			Submit
//	@Accept			multipart/form-data
//	@Produce		json
//	@Param			lectureid	path		int					true	"Lecture ID"
//	@Param			problemid	path		int					true	"Problem ID"
//	@Param			files		formData	[]file				true	"Files to validate"
//	@Success		200			{object}	response.Success	"Validation request registered successfully"
//	@Failure		400			{object}	response.Error		"Invalid request"
//	@Failure		500			{object}	response.Error		"Internal server error"
//	@Security		OAuth2Password[me]
//	@Router			/problem/validate/{lectureid}/{problemid} [post]
func (h *Handler) RequestValidation(c echo.Context) error {
	var req LectureIDProblemID
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid request payload"))
	}

	ctx := context.Background()

	// Fetch the resource path for this problem
	resourcePath, err := h.problemStore.FetchResourcePath(ctx, req.LectureID, req.ProblemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Problem not found"))
	}

	//-------------
	// Read files
	//------------

	// Multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid multipart form"))
	}
	files := form.File["files"]
	if len(files) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("No files uploaded"))
	}

	// File size validation
	var totalFileSize int64
	for _, file := range files {
		totalFileSize += file.Size
	}
	if totalFileSize > maxUncompressedSize {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError(fmt.Sprintf("Total file size exceeds the maximum limit (%d MB)", maxUncompressedSize/(1024*1024))))
	}

	// get user info from jwt
	claim, err := auth.GetJWTClaims(&c)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, response.NewError("Failed to get user info"))
	}

	userCode := claim.ID
	userID := claim.UserID

	requestTime := time.Now()

	// ---------------------------------------------------------------------------------------------
	// store files at dir: upload/validation/{userID}/{lectureID}/{problemID}/{YYYY-MM-DD-HH-mm-ss}/file
	// ---------------------------------------------------------------------------------------------
	basePath := filepath.Join(VALIDATION_DIR, fmt.Sprintf("%s/%d/%d/%s", userID, req.LectureID, req.ProblemID, requestTime.Format("2006-01-02-15-04-05")))
	uploadDir := filepath.Join(basePath, "file")

	// Check the existence of directory
	if info, err := os.Stat(uploadDir); err != nil {
		if os.IsNotExist(err) {
			// Directory does not exist
		} else if info.IsDir() {
			// Directory exists
			return echo.NewHTTPError(http.StatusConflict, response.NewError("your must not request validation for the same problem twice at the same time, please try again later"))
		} else {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to check upload directory"))
		}
	}

	// Make directory
	if err := os.MkdirAll(uploadDir, os.ModePerm); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to create upload directory"))
	}

	// Store files
	for _, file := range files {
		if file.Size > maxFileSize {
			// delete directory
			_ = os.RemoveAll(uploadDir)
			return echo.NewHTTPError(http.StatusBadRequest, response.NewError(fmt.Sprintf("File size exceeds the maximum limit (%d MB)", maxFileSize/(1024*1024))))
		}

		// Source
		src, err := file.Open()
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to open uploaded file"))
		}
		defer src.Close()

		// Sanitize file name to prevent path traversal attacks.
		cleanedPath := filepath.Join("/", filepath.Clean(file.Filename)) // resolve all "../" to prevent path traversal

		// Destination
		dstPath := filepath.Join(uploadDir, cleanedPath)
		// Ensure the destination path is within the uploadDir to prevent path traversal attacks
		if !strings.HasPrefix(dstPath, uploadDir) {
			return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid file name"))
		}
		dst, err := os.Create(dstPath)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to create destination file"))
		}
		defer dst.Close()

		// Copy
		if _, err := io.Copy(dst, src); err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to copy uploaded file"))
		}
	}

	// register file location
	fileLocation := model.FileLocation{
		Path: uploadDir,
		Ts:   requestTime,
	}
	err = h.fileStore.RegisterFileLocation(ctx, &fileLocation)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to register file location"))
	}

	// Make request entry
	request := model.ValidationRequest{
		TS:          requestTime,
		UserCode:    userCode,
		LectureID:   req.LectureID,
		ProblemID:   req.ProblemID,
		UploadDirID: fileLocation.ID,
		ResultID:    requeststatus.WJ,
	}

	// Register request
	err = h.requestStore.RegisterValidationRequest(ctx, &request)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to register validation request"))
	}

	// --------------------------------------
	// Submit this request to job queue.
	// --------------------------------------

	// Get Problem info
	problem, err := h.problemStore.GetProblemByID(ctx, req.LectureID, req.ProblemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get problem info"))
	}
	// All results are stored in {basePath}/result
	resultDir := filepath.Join(basePath, "result")

	filteredBuildTasks := make([]model.TestCase, 0)
	filteredJudgeTasks := make([]model.TestCase, 0)

	// Filter tasks if the role of requested user is not manager or admin.
	if claim.HasAllScopes(auth.ScopeGrading) || claim.HasAllScopes(auth.ScopeAdmin) {
		// Do nothing, keep all tasks
		filteredBuildTasks = problem.Detail.BuildTasks
		filteredJudgeTasks = problem.Detail.JudgeTasks
	} else {
		// Filter out tasks if "Evaluation" flat is true
		for _, task := range problem.Detail.BuildTasks {
			if !task.Evaluation {
				filteredBuildTasks = append(filteredBuildTasks, task)
			}
		}
		for _, task := range problem.Detail.JudgeTasks {
			if !task.Evaluation {
				filteredJudgeTasks = append(filteredJudgeTasks, task)
			}
		}
	}

	// Create JobQueue Entry
	job := model.JobQueue{
		RequestType: queuetype.Validation,
		RequestID:   request.ID,
		Status:      queuestatus.Pending,
		CreatedAt:   time.Now(),
		Detail: model.JobDetail{
			TimeMS:      problem.Detail.TimeMS,
			MemoryMB:    problem.Detail.MemoryMB,
			TestFiles:   problem.Detail.TestFiles,
			ResourceDir: resourcePath, // resource files for this problem
			FileDir:     uploadDir,
			ResultDir:   resultDir,
			BuildTasks:  filteredBuildTasks,
			JudgeTasks:  filteredJudgeTasks,
		},
	}

	// Register job
	err = h.jobQueueStore.InsertJob(ctx, &job)
	if err != nil {

		// update status of ValidationRequest to "IE (Internal Error)"
		err = h.requestStore.UpdateValidationRequestStatus(ctx, request.ID, requeststatus.IE)
		if err != nil {
			// TODO: log this with FATAL Level, because this should not happen.
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to update validation request status"))
		}

		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to register job"))
	}

	return c.JSON(http.StatusOK, response.NewSuccess("Validation request registered successfully"))
}

type ProblemIDPathParam struct {
	LectureID int64 `param:"lectureid"`
}

// BatchValidation godoc
//
//	@Summary		Request validation for all problems in a specific lecture entry.
//	@Description	This endpoint allows users to request validation for all problems within a specific lecture.
//	@Tags			Submit
//	@Accept			multipart/form-data
//	@Produce		json
//	@Param			lectureid	path		int					true	"Lecture ID"
//	@Param			zipfile		formData	file				true	"Zip file containing all program codes you're submitting"
//	@Success		200			{object}	response.Success	"Batch validation requests registered successfully"
//	@Failure		400			{object}	response.Error		"Invalid request payload"
//	@Failure		404			{object}	response.Error		"No problems found for the given lecture ID"
//	@Failure		500			{object}	response.Error		"Failed to register batch validation requests"
//	@Security		OAuth2Password[me]
//	@Router			/problem/validate/batch/{lectureid} [post]
func (h *Handler) BatchValidation(c echo.Context) error {
	var req ProblemIDPathParam
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid request payload"))
	}

	ctx := context.Background()

	// Check if the Lecture entry exists
	lecture, err := h.problemStore.GetLectureAndAllProblems(ctx, req.LectureID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to check lecture existence"+err.Error()))
	}

	problems := lecture.Problems
	if len(problems) == 0 {
		return echo.NewHTTPError(http.StatusNotFound, response.NewError("No problems found for the given lecture ID"))
	}

	// get user info from jwt
	claim, err := auth.GetJWTClaims(&c)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, response.NewError("Failed to get user info"))
	}

	userCode := claim.ID
	userID := claim.UserID

	requestTime := time.Now()

	//----------------------------------------------------------------------------
	// Read a zip file from formData, and then unzip it.
	//
	// Before unzipping it, we have to check the size of uncompressed files to prevent zip bomb attacks.
	//
	//
	// store files at dir: upload/validation/{userID}/{lectureID}/{YYYY-MM-DD-HH-mm-ss}/file
	// ---------------------------------------------------------------------------------------------
	zipFile, err := c.FormFile("zipfile")
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid zip file"))
	}

	// Check extension of the file
	if !strings.HasSuffix(zipFile.Filename, ".zip") {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid zip file format"))
	}

	// check the size of zip file
	if zipFile.Size > maxZipSize {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError(fmt.Sprintf("Zip file size exceeds the limit of %d bytes", maxZipSize)))
	}

	basePath := filepath.Join(VALIDATION_DIR, fmt.Sprintf("%s/%d/%s", userID, req.LectureID, requestTime.Format("2006-01-02-15-04-05")))
	uploadDir := filepath.Join(basePath, "file")

	// Check the existence of directory
	if info, err := os.Stat(uploadDir); err != nil {
		if os.IsNotExist(err) {
			// Directory does not exist
		} else if info.IsDir() {
			// Directory exists
			return echo.NewHTTPError(http.StatusConflict, response.NewError("you must not request grading for the same problem twice at the same time, please try again later"))
		} else {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to check upload directory"))
		}
	}

	// Open zip file
	src, err := zipFile.Open()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to open zip file"))
	}
	defer src.Close()

	// move to temporary directory
	tempFile, err := os.CreateTemp("", "upload-*.zip")
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to create temporary file"))
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	if _, err := io.Copy(tempFile, src); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to copy zip file to temporary file"))
	}

	// Extract zip file **safely**
	if err := fileutil.SafeExtractZip(tempFile.Name(), uploadDir); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Failed to extract zip file: "+err.Error()))
	}

	// ---------------------------------------------------------------------------
	// Remove metadata files and directories like __MACOSX, .DS_Store, etc.
	// ---------------------------------------------------------------------------
	if err := fileutil.RemoveMetaData(uploadDir); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to remove metadata files: "+err.Error()))
	}

	// ---------------------------------------------------------------------------
	// Remove object files like .o, .obj, etc
	// ---------------------------------------------------------------------------
	if err := fileutil.RemoveObjectFiles(uploadDir); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to remove object files: "+err.Error()))
	}

	// ---------------------------------------------------------------------------
	// Check if the first level of extracted dir contains only one folder.
	// In this case, unnest it.
	//
	// e.g.,
	// class1.zip
	//   |- class1/
	//        |- main.c
	//        |- Makefile
	//        |- Report.pdf
	// ---------------------------------------------------------------------------
	files, err := os.ReadDir(uploadDir)
	if err != nil {
		defer os.RemoveAll(uploadDir)
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to read upload directory"))
	}
	if len(files) == 1 && files[0].IsDir() {
		// Unnest the folder
		unnestDir := fmt.Sprintf("%s/%s", uploadDir, files[0].Name())
		uploadDir = unnestDir
	}

	// Register file location
	fileLocation := model.FileLocation{
		Path: uploadDir,
		Ts:   requestTime,
	}
	err = h.fileStore.RegisterFileLocation(ctx, &fileLocation)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to register file location"))
	}

	RequiringFilter := !claim.HasAllScopes(auth.ScopeGrading) && !claim.HasAllScopes(auth.ScopeAdmin)

	for _, problem := range problems {
		// Make request entry
		request := model.ValidationRequest{
			TS:          requestTime,
			UserCode:    userCode,
			LectureID:   req.LectureID,
			ProblemID:   problem.ProblemID,
			UploadDirID: fileLocation.ID,
			ResultID:    requeststatus.WJ,
		}

		// Fetch resource path for this problem
		resourcePath, err := h.problemStore.FetchResourcePath(ctx, problem.LectureID, problem.ProblemID)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Problem not found"))
		}

		// -------------------------------------------------------------
		// Register request
		// -------------------------------------------------------------
		err = h.requestStore.RegisterValidationRequest(ctx, &request)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to register validation request"))
		}

		// -------------------------------------------------------------
		// Submit this request to job queue.
		//
		// Result data for each problem is stored in:
		// {basePath}/result/{problemID}
		// -------------------------------------------------------------
		resultDir := filepath.Join(basePath, "result", fmt.Sprintf("%d", problem.ProblemID))
		filteredBuildTasks := make([]model.TestCase, 0)
		filteredJudgeTasks := make([]model.TestCase, 0)

		if RequiringFilter {
			// Filter out tasks if "Evaluation" flat is true
			for _, task := range problem.Detail.BuildTasks {
				if !task.Evaluation {
					filteredBuildTasks = append(filteredBuildTasks, task)
				}
			}
			for _, task := range problem.Detail.JudgeTasks {
				if !task.Evaluation {
					filteredJudgeTasks = append(filteredJudgeTasks, task)
				}
			}
		} else {
			// Do nothing, keep all tasks.
			filteredBuildTasks = problem.Detail.BuildTasks
			filteredJudgeTasks = problem.Detail.JudgeTasks
		}

		// Make an entity pushing to job queue.
		job := model.JobQueue{
			RequestType: queuetype.Validation,
			RequestID:   request.ID,
			Status:      queuestatus.Pending,
			CreatedAt:   time.Now(),
			Detail: model.JobDetail{
				TimeMS:      problem.Detail.TimeMS,
				MemoryMB:    problem.Detail.MemoryMB,
				TestFiles:   problem.Detail.TestFiles,
				ResourceDir: resourcePath,
				FileDir:     uploadDir,
				ResultDir:   resultDir,
				BuildTasks:  filteredBuildTasks,
				JudgeTasks:  filteredJudgeTasks,
			},
		}

		// Register job
		err = h.jobQueueStore.InsertJob(ctx, &job)
		if err != nil {
			// update status of ValidationRequest to "IE (Internal Error)"
			err = h.requestStore.UpdateValidationRequestStatus(ctx, request.ID, requeststatus.IE)
			if err != nil {
				// TODO: log this with FATAL Level, because this should not happen.
				return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to update validation request status"))
			}

			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to register job"))
		}
	}

	return c.JSON(http.StatusOK, response.NewSuccess("Batch validation requests registered successfully"))
}

type GradingRequestParam struct {
	LectureID    int64  `param:"lectureid" validate:"required"`
	ProblemID    int64  `param:"problemid" validate:"required"`
	TargetUserID string `form:"userid" validate:"required"`
	SubmissionTS int64  `form:"ts" default:"1764464361" validate:"required"`
}

func (grp *GradingRequestParam) bind(c echo.Context) error {
	if err := c.Bind(grp); err != nil {
		return err
	}
	if err := c.Validate(grp); err != nil {
		return err
	}
	return nil
}

// RequestGrading godoc
//
//	@Summary		Request grading
//	@Description	request a grading request, which is compiling program codes, and executes all test cases. note that the submission timestamp is specified by the user (manager or admin), and the target user ID (e.g., student) is also specified by the user.
//	@Tags			Submit
//	@Accept			multipart/form-data
//	@Produce		json
//	@Param			lectureid	path		int					true	"Lecture ID"
//	@Param			problemid	path		int					true	"Problem ID"
//	@Param			userid		formData	string				true	"User ID targeted for grading"
//	@Param			ts			formData	int					true	"Submission Timestamp, epoch seconds (e.g., 1764464361)"
//	@Param			files		formData	[]file				true	"Files to be graded"
//	@Success		200			{object}	response.Success	"Grading request registered successfully"
//	@Failure		400			{object}	response.Error		"Invalid request payload"
//	@Failure		404			{object}	response.Error		"Problem not found"
//	@Failure		500			{object}	response.Error		"Internal server error"
//	@Security		OAuth2Password[grading]
//	@Router			/problem/judge/{lectureid}/{problemid} [post]
func (h *Handler) RequestGrading(c echo.Context) error {
	req := &GradingRequestParam{}
	if err := req.bind(c); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid request payload"+err.Error()))
	}

	// convert epoch seconds to time.Time
	submissionTS := time.Unix(req.SubmissionTS, 0)

	ctx := context.Background()

	// Fetch the resource path for this problem
	resourcePath, err := h.problemStore.FetchResourcePath(ctx, req.LectureID, req.ProblemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Problem not found"))
	}

	// Check the existence of problem entry
	exists, err := h.problemStore.CheckProblemExists(ctx, req.LectureID, req.ProblemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to check problem existence"))
	}
	if !exists {
		return echo.NewHTTPError(http.StatusNotFound, response.NewError("Problem not found"))
	}

	// Get user code of user subjected to grading
	userCodeOfSubject, err := h.userStore.GetIDByUserID(ctx, req.TargetUserID)
	if err != nil || userCodeOfSubject == nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Targeted user does not exist"))
	}

	//-------------
	// Read files
	//------------

	// Multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid multipart form"))
	}
	files := form.File["files"]
	if len(files) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("No files uploaded"))
	}

	// File size validation
	var totalFileSize int64
	for _, file := range files {
		totalFileSize += file.Size
	}
	if totalFileSize > maxUncompressedSize {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError(fmt.Sprintf("Total file size exceeds the maximum limit (%d MB)", maxUncompressedSize/(1024*1024))))
	}

	// get user info from jwt
	claim, err := auth.GetJWTClaims(&c)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, response.NewError("Failed to get user info"))
	}

	userCodeOfRequester := claim.ID

	requestTime := time.Now()

	// ---------------------------------------------------------------------------------------------
	// store files at dir: upload/grading/{userID}/{lectureID}/{problemID}/{YYYY-MM-DD-HH-mm-ss}/{YYYY-MM-DD-HH-mm-ss}/file
	//
	// Note:
	// {userID} is the ID of the user subjected to grading.
	// First {YYYY-MM-DD-HH-mm-ss} is the submission timestamp specified by the user, which is the actual timestamp when target user submit
	// program codes for grading.
	// Second {YYYY-MM-DD-HH-mm-ss} is the request timestamp.
	// ---------------------------------------------------------------------------------------------
	basePath := filepath.Join(GRADING_DIR, fmt.Sprintf("%s/%d/%d/%s/%s", req.TargetUserID, req.LectureID, req.ProblemID, submissionTS.Format("2006-01-02-15-04-05"), requestTime.Format("2006-01-02-15-04-05")))
	uploadDir := filepath.Join(basePath, "file")

	// Check the existence of directory
	if info, err := os.Stat(uploadDir); err != nil {
		if os.IsNotExist(err) {
			// Directory does not exist
		} else if info.IsDir() {
			// Directory exists
			return echo.NewHTTPError(http.StatusConflict, response.NewError("you must not request grading for the same problem twice at the same time, please try again later"))
		} else {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to check upload directory"))
		}
	}

	// Make directory
	if err := os.MkdirAll(uploadDir, os.ModePerm); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to create upload directory"))
	}

	// Store files
	for _, file := range files {
		if file.Size > maxFileSize {
			// delete directory
			_ = os.RemoveAll(uploadDir)
			return echo.NewHTTPError(http.StatusBadRequest, response.NewError(fmt.Sprintf("File size exceeds the maximum limit (%d MB)", maxFileSize/(1024*1024))))
		}

		// Source
		src, err := file.Open()
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to open uploaded file"))
		}
		defer src.Close()

		// Destination

		// Sanitize file name to prevent path traversal attacks.
		cleanedPath := filepath.Join("/", filepath.Clean(file.Filename)) // resolve all "../" to prevent path traversal

		dstPath := filepath.Join(uploadDir, cleanedPath)
		// Ensure the destination path is within the uploadDir to prevent path traversal attacks
		if !strings.HasPrefix(dstPath, uploadDir) {
			return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid file name"))
		}
		dst, err := os.Create(dstPath)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to create destination file"))
		}
		defer dst.Close()

		// Copy
		if _, err := io.Copy(dst, src); err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to copy uploaded file"))
		}
	}

	// register file location
	fileLocation := model.FileLocation{
		Path: uploadDir,
		Ts:   requestTime,
	}
	err = h.fileStore.RegisterFileLocation(ctx, &fileLocation)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to register file location"))
	}

	// Make request entry
	request := model.GradingRequest{
		LectureID:       req.LectureID,
		ProblemID:       req.ProblemID,
		UserCode:        *userCodeOfSubject,
		SubmissionTS:    submissionTS,
		TS:              requestTime,
		RequestUserCode: userCodeOfRequester,
		UploadDirID:     fileLocation.ID,
		ResultID:        requeststatus.WJ,
	}

	// Register request
	err = h.requestStore.RegisterOrUpdateGradingRequest(ctx, &request)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to register grading request"))
	}

	// --------------------------------------
	// Submit this request to job queue.
	// --------------------------------------

	// Get Problem info
	problem, err := h.problemStore.GetProblemByID(ctx, req.LectureID, req.ProblemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to get problem info"))
	}
	// All results are stored in {basePath}/result
	resultDir := filepath.Join(basePath, "result")

	// Create JobQueue Entry
	job := model.JobQueue{
		RequestType: queuetype.Grading,
		RequestID:   request.ID,
		Status:      queuestatus.Pending,
		CreatedAt:   time.Now(),
		Detail: model.JobDetail{
			TimeMS:      problem.Detail.TimeMS,
			MemoryMB:    problem.Detail.MemoryMB,
			TestFiles:   problem.Detail.TestFiles,
			ResourceDir: resourcePath, // resource files for this problem
			FileDir:     uploadDir,
			ResultDir:   resultDir,
			BuildTasks:  problem.Detail.BuildTasks, // We do not any filtering here, because only manager or admin can access this endpoint.
			JudgeTasks:  problem.Detail.JudgeTasks,
		},
	}

	// Register job
	err = h.jobQueueStore.InsertJob(ctx, &job)
	if err != nil {

		// update status of GradingRequest to "IE (Internal Error)"
		err = h.requestStore.UpdateGradingRequestStatus(ctx, request.ID, requeststatus.IE)
		if err != nil {
			// TODO: log this with FATAL Level, because this should not happen.
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to update grading request status"))
		}

		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to register job"))
	}

	return c.JSON(http.StatusOK, response.NewSuccess("Grading request registered successfully"))
}

type BatchGradingParam struct {
	LectureID    int64  `param:"lectureid" validate:"required"`
	TargetUserID string `form:"userid" validate:"required"`
	SubmissionTS int64  `form:"ts" default:"1764464361" validate:"required"`
}

func (bgp *BatchGradingParam) bind(c echo.Context) error {
	if err := c.Bind(bgp); err != nil {
		return err
	}
	if err := c.Validate(bgp); err != nil {
		return err
	}
	return nil
}

// BatchGrading godoc
//
//	@Summary		Request batched grading requests for all problems in a specific lecture entry.
//	@Description	This endpoint allows instructors to request grading for all problems in a specific lecture entry in a single request.
//	@Tags			Submit
//	@Accept			multipart/form-data
//	@Produce		json
//	@Param			lectureid	path		int					true	"Lecture ID"
//	@Param			userid		formData	string				true	"User ID"
//	@Param			ts			formData	int64				true	"Submission Timestamp, epoch seconds (e.g., 1764464361)"
//	@Param			zipfile		formData	file				true	"Zip file containing all files user submitted"
//	@Success		200			{object}	response.Success	"Batched grading requests registered successfully"
//	@Failure		400			{object}	response.Error		"Invalid request payload"
//	@Failure		404			{object}	response.Error		"No problems found for the given lecture ID"
//	@Failure		500			{object}	response.Error		"Failed to register grading request"
//	@Security		OAuth2Password[grading]
//	@Router			/problem/judge/batch/{lectureid} [post]
func (h *Handler) BatchGrading(c echo.Context) error {
	var req BatchGradingParam
	if err := req.bind(c); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid request payload"))
	}

	// convert epoch seconds to time.Time
	submissionTS := time.Unix(req.SubmissionTS, 0)

	ctx := context.Background()

	// Check if the Lecture entry exists
	lecture, err := h.problemStore.GetLectureAndAllProblems(ctx, req.LectureID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to check lecture existence"+err.Error()))
	}

	problems := lecture.Problems
	if len(problems) == 0 {
		return echo.NewHTTPError(http.StatusNotFound, response.NewError("No problems found for the given lecture ID"))
	}

	// Get user code of user subjected to grading
	userCodeOfSubject, err := h.userStore.GetIDByUserID(ctx, req.TargetUserID)
	if err != nil || userCodeOfSubject == nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Targeted user does not exist"))
	}

	// get user info from jwt
	claim, err := auth.GetJWTClaims(&c)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, response.NewError("Failed to get user info"))
	}

	userCodeOfRequester := claim.ID
	requestTime := time.Now()

	//----------------------------------------------------------------------------
	// Read a zip file from formData, and then unzip it.
	//
	// Before unzipping it, we have to check the size of uncompressed files to prevent zip bomb attacks.
	//
	//
	// store files at dir: upload/grading/{userID}/{lectureID}/{YYYY-MM-DD-HH-mm-ss}/{YYYY-MM-DD-HH-mm-ss}/file
	// Note:
	// {userID} is the ID of the user being graded.
	// First {YYYY-MM-DD-HH-mm-ss} is the submission timestamp specified by the user, which is the
	// actual timestamp when target user submitted program codes for grading.
	// Second {YYYY-MM-DD-HH-mm-ss} is the timestamp when the grading request was created.
	// ---------------------------------------------------------------------------------------------
	zipFile, err := c.FormFile("zipfile")
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid zip file"))
	}

	// Check extension of the file
	if !strings.HasSuffix(zipFile.Filename, ".zip") {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Invalid zip file format"))
	}

	// check the size of zip file
	if zipFile.Size > maxZipSize {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError(fmt.Sprintf("Zip file size exceeds the limit of %d bytes", maxZipSize)))
	}

	basePath := filepath.Join(GRADING_DIR, fmt.Sprintf("%s/%d/%s/%s", req.TargetUserID, req.LectureID, submissionTS.Format("2006-01-02-15-04-05"), requestTime.Format("2006-01-02-15-04-05")))
	uploadDir := filepath.Join(basePath, "file")

	// Check the existence of directory
	if info, err := os.Stat(uploadDir); err != nil {
		if os.IsNotExist(err) {
			// Directory does not exist
		} else if info.IsDir() {
			// Directory exists
			return echo.NewHTTPError(http.StatusConflict, response.NewError("you must not request grading for the same problem twice at the same time, please try again later"))
		} else {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to check upload directory"))
		}
	}

	// Open zip file
	src, err := zipFile.Open()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to open zip file"))
	}
	defer src.Close()

	// move to temporary directory
	tempFile, err := os.CreateTemp("", "upload-*.zip")
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to create temporary file"))
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	if _, err := io.Copy(tempFile, src); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to copy zip file to temporary file"))
	}

	// Extract zip file **safely**
	if err := fileutil.SafeExtractZip(tempFile.Name(), uploadDir); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("Failed to extract zip file: "+err.Error()))
	}

	// ---------------------------------------------------------------------------
	// Remove metadata files and directories like __MACOSX, .DS_Store, etc.
	// ---------------------------------------------------------------------------
	if err := fileutil.RemoveMetaData(uploadDir); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to remove metadata files: "+err.Error()))
	}

	// ---------------------------------------------------------------------------
	// Remove object files like .o, .obj, etc
	// ---------------------------------------------------------------------------
	if err := fileutil.RemoveObjectFiles(uploadDir); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to remove object files: "+err.Error()))
	}

	// ---------------------------------------------------------------------------
	// Check if the first level of extracted dir contains only one folder.
	// In this case, unnest it.
	//
	// e.g.,
	// class1.zip
	//   |- class1/
	//        |- main.c
	//        |- Makefile
	//        |- Report.pdf
	// ---------------------------------------------------------------------------
	files, err := os.ReadDir(uploadDir)
	if err != nil {
		defer os.RemoveAll(uploadDir)
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to read upload directory"))
	}
	if len(files) == 1 && files[0].IsDir() {
		// Unnest the folder
		unnestDir := fmt.Sprintf("%s/%s", uploadDir, files[0].Name())
		uploadDir = unnestDir
	}

	// Register file location
	fileLocation := model.FileLocation{
		Path: uploadDir,
		Ts:   requestTime,
	}
	err = h.fileStore.RegisterFileLocation(ctx, &fileLocation)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to register file location"))
	}

	// Make request body for each problem entries

	for _, problem := range problems {
		// Make request entry
		request := model.GradingRequest{
			LectureID:       req.LectureID,
			ProblemID:       problem.ProblemID,
			UserCode:        *userCodeOfSubject,
			SubmissionTS:    submissionTS,
			TS:              requestTime,
			RequestUserCode: userCodeOfRequester,
			UploadDirID:     fileLocation.ID,
			ResultID:        requeststatus.WJ,
		}

		// Fetch the resource path for this problem
		resourcePath, err := h.problemStore.FetchResourcePath(ctx, problem.LectureID, problem.ProblemID)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Problem not found"))
		}

		// -------------------------------------------------------------
		// Register request
		// -------------------------------------------------------------
		err = h.requestStore.RegisterOrUpdateGradingRequest(ctx, &request)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to register grading request"))
		}

		// -------------------------------------------------------------
		// Submit this request to job queue.
		//
		// Result data for each problem is stored in:
		// {basePath}/result/{problemID}
		// -------------------------------------------------------------
		resultDir := filepath.Join(basePath, "result", fmt.Sprintf("%d", problem.ProblemID))

		// Make an entity pushing to job queue.
		job := model.JobQueue{
			RequestType: queuetype.Grading,
			RequestID:   request.ID,
			Status:      queuestatus.Pending,
			CreatedAt:   time.Now(),
			Detail: model.JobDetail{
				TimeMS:      problem.Detail.TimeMS,
				MemoryMB:    problem.Detail.MemoryMB,
				TestFiles:   problem.Detail.TestFiles,
				ResourceDir: resourcePath,
				FileDir:     uploadDir,
				ResultDir:   resultDir,
				BuildTasks:  problem.Detail.BuildTasks, // We do not any filtering here, because only manager or admin can access this endpoint.
				JudgeTasks:  problem.Detail.JudgeTasks,
			},
		}

		// Register job
		err = h.jobQueueStore.InsertJob(ctx, &job)
		if err != nil {
			// update status of GradingRequest to "IE (Internal Error)"
			err = h.requestStore.UpdateGradingRequestStatus(ctx, request.ID, requeststatus.IE)
			if err != nil {
				// TODO: log this with FATAL Level, because this should not happen.
				return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to update grading request status"))
			}

			return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("Failed to register job"))
		}
	}

	return c.JSON(http.StatusOK, response.NewSuccess("Batched grading requests registered successfully"))
}
