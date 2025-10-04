package problem

import (
	"context"
	"dsa-backend/handler/auth"
	"dsa-backend/handler/problem/util"
	"dsa-backend/handler/response"
	"fmt"
	"net/http"
	"time"

	"github.com/dsa-uts/dsa-project/database/model"
	"github.com/labstack/echo/v4"
)

// ListProblems godoc
//
//	@Summary		list all problem entry, nested in lecture entry.
//	@Description	get all lecture entries, each containing its problem entries. When you don't have scopes "grading" or "admin", you will only see lecture entries that are published.
//	@Tags			Fetch
//	@Produce		json
//	@Success		200	{array}		util.LectureEntry
//	@Failure		500	{object}	response.Error	"failed to get lecture entries"
//	@Security		OAuth2Password[me]
//	@Router			/problem/fetch/list [get]
func (h *Handler) ListProblems(c echo.Context) error {
	ctx := context.Background()

	// Check your role
	jwtClaim, err := auth.GetJWTClaims(&c)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, response.NewError("failed to get JWT claims"))
	}
	rightsToSeeAll := jwtClaim.HasAllScopes(auth.ScopeGrading) || jwtClaim.HasAllScopes(auth.ScopeAdmin)
	filter := !rightsToSeeAll

	responseList, err := util.FetchLectureEntry(ctx, h.problemStore, filter)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to fetch lecture entries"))
	}
	return c.JSON(200, responseList)
}

type ProblemDetailRequest struct {
	LectureID int64 `json:"lecture_id" param:"lectureid"`
	ProblemID int64 `json:"problem_id" param:"problemid"`
}

// GetProblemInfo godoc
//
//	@Summary		Get problem detail
//	@Description	Get detailed information about a specific problem within a lecture.
//	@Tags			Fetch
//	@Produce		json
//	@Param			lectureid	path		int64	true	"Lecture ID"
//	@Param			problemid	path		int64	true	"Problem ID"
//	@Success		200			{object}	util.ProblemDetail
//	@Failure		400			{object}	response.Error	"invalid request"
//	@Failure		404			{object}	response.Error	"problem not found"
//	@Failure		500			{object}	response.Error	"failed to get problem"
//	@Security		OAuth2Password[me]
//	@Router			/problem/fetch/detail/{lectureid}/{problemid} [get]
func (h *Handler) GetProblemInfo(c echo.Context) error {
	ctx := context.Background()
	var req ProblemDetailRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, response.NewError("invalid request"))
	}

	// Check your role
	jwtClaim, err := auth.GetJWTClaims(&c)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, response.NewError("failed to get JWT claims"))
	}
	rightsToSeeAll := jwtClaim.HasAllScopes(auth.ScopeGrading) || jwtClaim.HasAllScopes(auth.ScopeAdmin)
	filter := !rightsToSeeAll

	detail, err := util.FetchProblemDetail(ctx, h.problemStore, h.fileStore, req.LectureID, req.ProblemID, filter)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to get problem"))
	}

	return c.JSON(http.StatusOK, *detail)
}

type RequiredFiles struct {
	LectureID int64    `json:"lecture_id"`
	Title     string   `json:"title"`
	Files     []string `json:"files"`
}

type ListRequiredFilesResponse struct {
	List []RequiredFiles `json:"list"`
}

// ListRequiredFiles godoc
//
//	@Summary		List required files for each lecture
//	@Description	Get a list of required files for each lecture, including problem-specific files and a report template.
//	@Tags			Fetch
//	@Produce		json
//	@Success		200	{object}	ListRequiredFilesResponse
//	@Failure		500	{object}	response.Error	"failed to get lecture list"
//	@Security		OAuth2Password[me]
//	@Router			/problem/fetch/requiredfiles [get]
func (h *Handler) ListRequiredFiles(c echo.Context) error {
	ctx := context.Background()

	lectureList, err := h.problemStore.GetAllLectureAndProblems(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, response.NewError("failed to get lecture list"))
	}

	// Check JWT claims
	jwtClaim, err := auth.GetJWTClaims(&c)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, response.NewError("failed to get JWT claims"))
	}

	rightsToSeeAll := jwtClaim.HasAllScopes(auth.ScopeGrading) || jwtClaim.HasAllScopes(auth.ScopeAdmin)
	filter := !rightsToSeeAll

	// filter LectureList based on publication status
	filteredLectureList := make([]model.Lecture, 0)
	if filter {
		for _, lecture := range lectureList {
			if lecture.StartDate.After(time.Now()) {
				continue
			}
			filteredLectureList = append(filteredLectureList, lecture)
		}
	} else {
		filteredLectureList = lectureList
	}

	responseList := make([]RequiredFiles, 0)

	for _, lecture := range filteredLectureList {
		fileSet := make(map[string]struct{})
		fileList := make([]string, 0)

		for _, problem := range lecture.Problems {
			for _, filename := range problem.Detail.RequiredFiles {
				_, exists := fileSet[filename]
				if exists {
					continue
				}

				fileSet[filename] = struct{}{}
				fileList = append(fileList, filename)
			}
		}

		fileList = append(fileList, fmt.Sprintf("report%d.pdf", lecture.ID))
		responseList = append(responseList, RequiredFiles{
			LectureID: lecture.ID,
			Title:     lecture.Title,
			Files:     fileList,
		})
	}

	return c.JSON(http.StatusOK, ListRequiredFilesResponse{
		List: responseList,
	})
}
