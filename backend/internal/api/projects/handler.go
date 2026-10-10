package projects

import (
	"context"
	"errors"
	"net/http"
	"sort"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/resourceimport"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/labstack/echo/v4"
	"golang.org/x/mod/semver"
)

type Handler struct {
	projects *store.ProjectStore
	source   *resourceimport.Source
}

func NewHandler(projects *store.ProjectStore, source *resourceimport.Source) *Handler {
	return &Handler{projects: projects, source: source}
}

func (h *Handler) ListProjects(ctx context.Context, req generated.ListProjectsRequestObject) (generated.ListProjectsResponseObject, error) {
	projects, err := h.projects.ListProjects(ctx, httpauth.Actor(ctx).Role == "student")
	if err != nil {
		return nil, err
	}
	result := make([]generated.Project, 0, len(projects))
	for _, p := range projects {
		snapshot := p.ResourceJSON
		item := generated.Project{
			Id:              p.ID,
			ResourceId:      p.ResourceID,
			Name:            p.Name,
			Description:     snapshot.Metadata.Description,
			LatestVersionId: p.LatestVersionID,
			LatestVersion:   p.Version,
			DisplayOrder:    p.DisplayOrder,
			PublishedAt:     p.PublishedAt,
			Deadline:        p.Deadline,
			Workflows: make([]struct {
				Id   string `json:"id"`
				Name string `json:"name"`
			}, 0, len(snapshot.Workflows)),
		}
		for id, workflow := range snapshot.Workflows {
			item.Workflows = append(item.Workflows, struct {
				Id   string `json:"id"`
				Name string `json:"name"`
			}{id, workflow.Name})
		}
		sort.Slice(item.Workflows, func(i, j int) bool { return item.Workflows[i].Id < item.Workflows[j].Id })
		result = append(result, item)
	}
	return generated.ListProjects200JSONResponse{Projects: result}, nil
}

func (h *Handler) GetProject(ctx context.Context, req generated.GetProjectRequestObject) (generated.GetProjectResponseObject, error) {
	p, err := h.projects.GetProject(ctx, req.ProjectId, httpauth.Actor(ctx).Role == "student")
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, echo.NewHTTPError(http.StatusNotFound, "Project not found.")
	}
	detail := projectDetail(p)
	return generated.GetProject200JSONResponse(detail), err
}

func projectDetail(p *store.ProjectLatest) generated.ProjectDetail {
	snapshot := p.ResourceJSON
	detail := generated.ProjectDetail{
		Id:              p.ID,
		ResourceId:      p.ResourceID,
		Name:            p.Name,
		Description:     snapshot.Metadata.Description,
		LatestVersionId: p.LatestVersionID,
		LatestVersion:   p.Version,
		DisplayOrder:    p.DisplayOrder,
		PublishedAt:     p.PublishedAt,
		Deadline:        p.Deadline,
		RequiredFiles:   append([]string{}, snapshot.RequiredFiles...),
		Workflows: make([]struct {
			DescriptionMarkdown string `json:"description_markdown"`
			Id                  string `json:"id"`
			Name                string `json:"name"`
		}, 0, len(snapshot.Workflows)),
	}
	for id, workflow := range snapshot.Workflows {
		detail.Workflows = append(detail.Workflows, struct {
			DescriptionMarkdown string `json:"description_markdown"`
			Id                  string `json:"id"`
			Name                string `json:"name"`
		}{workflow.Description, id, workflow.Name})
	}
	sort.Slice(detail.Workflows, func(i, j int) bool { return detail.Workflows[i].Id < detail.Workflows[j].Id })
	return detail
}

func (h *Handler) UpdateProjects(ctx context.Context, req generated.UpdateProjectsRequestObject) (generated.UpdateProjectsResponseObject, error) {
	updates := make([]store.ProjectUpdate, 0, len(req.Body.Projects))
	for _, p := range req.Body.Projects {
		if p.PublishedAt != nil && p.Deadline != nil && p.PublishedAt.After(*p.Deadline) {
			return nil, echo.NewHTTPError(http.StatusUnprocessableEntity, "Deadline must not precede publication")
		}
		updates = append(updates, store.ProjectUpdate{ID: p.Id, PublishedAt: p.PublishedAt, Deadline: p.Deadline})
	}
	err := h.projects.UpdateProjects(ctx, updates)
	if errors.Is(err, store.ErrProjectIDsMismatch) {
		return nil, echo.NewHTTPError(http.StatusConflict, "Projects changed. Reload the complete list and save again.")
	}
	if err != nil {
		return nil, err
	}
	return generated.UpdateProjects204Response{}, nil
}

func (h *Handler) ImportResource(ctx context.Context, req generated.ImportResourceRequestObject) (generated.ImportResourceResponseObject, error) {
	id, version := req.Body.ResourceId, req.Body.Version
	if !resourceimport.ValidVersion(version) {
		return nil, echo.NewHTTPError(http.StatusUnprocessableEntity, "Version must be a formal vMAJOR.MINOR.PATCH.")
	}
	current, err := h.projects.CurrentVersion(ctx, id)
	if err != nil {
		return nil, err
	}
	if current != nil {
		switch semver.Compare(version, current.Version) {
		case -1:
			return nil, importError(store.ErrOlderResourceVersion)
		case 0:
			return importResponse(current, false), nil
		}
	}
	snapshot, err := h.source.Fetch(ctx, id, version)
	if err != nil {
		return nil, importError(err)
	}
	current, changed, err := h.projects.ImportVersion(ctx, *snapshot)
	if err != nil {
		return nil, importError(err)
	}
	return importResponse(current, changed), nil
}

func importResponse(p *store.ProjectLatest, changed bool) generated.ImportResource200JSONResponse {
	return generated.ImportResource200JSONResponse{ProjectId: p.ID, VersionId: p.LatestVersionID, ResourceId: p.ResourceID, Version: p.Version, Changed: changed}
}

func importError(err error) error {
	switch {
	case errors.Is(err, store.ErrOlderResourceVersion):
		return echo.NewHTTPError(
			http.StatusConflict,
			"The requested Version is older than the current Version.",
		)
	case errors.Is(err, resourceimport.ErrNotFound):
		return echo.NewHTTPError(
			http.StatusNotFound,
			"The requested Resource Version is not in the index.",
		)
	case errors.Is(err, resourceimport.ErrInvalid),
		errors.Is(err, resourceimport.ErrHashMismatch):
		return echo.NewHTTPError(
			http.StatusUnprocessableEntity,
			"Resource validation failed.",
		)
	case errors.Is(err, resourceimport.ErrUnavailable):
		return echo.NewHTTPError(http.StatusServiceUnavailable).
			SetInternal(err)
	default:
		return err
	}
}
