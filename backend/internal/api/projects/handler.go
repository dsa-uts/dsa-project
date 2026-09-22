package projects

import (
	"context"
	"encoding/json"
	"errors"
	"sort"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpresponse"
	"github.com/dsa-uts/dsa-project/backend/internal/resourceimport"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
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
		// Decode only summary fields. Private jobs, presets and expected outputs never
		// enter the response DTO. The complete snapshot was validated on import.
		var snapshot struct {
			Workflows map[string]struct {
				Name string `json:"name"`
			} `json:"workflows"`
		}
		if err := json.Unmarshal(p.ResourceJSON, &snapshot); err != nil {
			return nil, err
		}
		item := generated.Project{Id: p.ID, ResourceId: p.ResourceID, Name: p.Name,
			LatestVersionId: p.LatestVersionID, LatestVersion: p.Version, DisplayOrder: p.DisplayOrder,
			PublishedAt: p.PublishedAt, Deadline: p.Deadline, Workflows: make([]struct {
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

func (h *Handler) UpdateProjects(ctx context.Context, req generated.UpdateProjectsRequestObject) (generated.UpdateProjectsResponseObject, error) {
	updates := make([]store.ProjectUpdate, 0, len(req.Body.Projects))
	for _, p := range req.Body.Projects {
		if p.PublishedAt != nil && p.Deadline != nil && p.PublishedAt.After(*p.Deadline) {
			return generated.UpdateProjects422JSONResponse(httpresponse.NewError("validation_failed", "Deadline must not precede publication.")), nil
		}
		updates = append(updates, store.ProjectUpdate{ID: p.Id, PublishedAt: p.PublishedAt, Deadline: p.Deadline})
	}
	err := h.projects.UpdateProjects(ctx, updates)
	if errors.Is(err, store.ErrProjectIDsMismatch) {
		return generated.UpdateProjects422JSONResponse(httpresponse.NewError("project_ids_mismatch", "Projects changed. Reload the complete list and save again.")), nil
	}
	if err != nil {
		return nil, err
	}
	return generated.UpdateProjects204Response{}, nil
}

func (h *Handler) ImportResource(ctx context.Context, req generated.ImportResourceRequestObject) (generated.ImportResourceResponseObject, error) {
	id, version := req.Body.ResourceId, req.Body.Version
	if !resourceimport.ValidVersion(version) {
		return generated.ImportResource422JSONResponse(httpresponse.NewError("invalid_resource_version", "Version must be a formal vMAJOR.MINOR.PATCH.")), nil
	}
	current, err := h.projects.CurrentVersion(ctx, id)
	if err != nil {
		return nil, err
	}
	if current != nil {
		switch semver.Compare(version, current.Version) {
		case -1:
			return importError(store.ErrOlderResourceVersion)
		case 0:
			return importResponse(current, false), nil
		}
	}
	snapshot, err := h.source.Fetch(ctx, id, version)
	if err != nil {
		return importError(err)
	}
	data, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	current, changed, err := h.projects.ImportVersion(ctx, id, snapshot.Metadata.Name, version, data)
	if err != nil {
		return importError(err)
	}
	return importResponse(current, changed), nil
}

func importResponse(p *store.ProjectLatest, changed bool) generated.ImportResource200JSONResponse {
	return generated.ImportResource200JSONResponse{ProjectId: p.ID, VersionId: p.LatestVersionID, ResourceId: p.ResourceID, Version: p.Version, Changed: changed}
}

func importError(err error) (generated.ImportResourceResponseObject, error) {
	switch {
	case errors.Is(err, store.ErrOlderResourceVersion):
		return generated.ImportResource409JSONResponse(httpresponse.NewError(err.Error(), "The requested Version is older than the current Version.")), nil
	case errors.Is(err, resourceimport.ErrNotFound):
		return generated.ImportResource404JSONResponse(httpresponse.NewError(err.Error(), "The requested Resource Version is not in the index.")), nil
	case errors.Is(err, resourceimport.ErrInvalid), errors.Is(err, resourceimport.ErrHashMismatch):
		return generated.ImportResource422JSONResponse(httpresponse.NewError(err.Error(), "Resource validation failed.")), nil
	case errors.Is(err, resourceimport.ErrUnavailable):
		return generated.ImportResource503JSONResponse(httpresponse.NewError(err.Error(), "The Resource source is unavailable.")), nil
	default:
		return nil, err
	}
}
