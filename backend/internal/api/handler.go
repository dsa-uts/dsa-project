package api

import (
	"github.com/dsa-uts/dsa-project/backend/internal/api/admin/users"
	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/projects"
	"github.com/dsa-uts/dsa-project/backend/internal/api/sessions"
	"github.com/dsa-uts/dsa-project/backend/internal/resourceimport"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

// Local aliases give the embedded feature handlers distinct field names.
type sessionHandler = sessions.Handler
type userHandler = users.Handler
type projectHandler = projects.Handler

// handler composes the feature handlers into the generated interface.
type handler struct {
	*sessionHandler
	*userHandler
	*projectHandler
}

var _ generated.StrictServerInterface = (*handler)(nil)

func newHandler(authStore *store.AuthStore, projectStore *store.ProjectStore, source *resourceimport.Source) *handler {
	return &handler{
		sessionHandler: sessions.NewHandler(authStore),
		projectHandler: projects.NewHandler(projectStore, source),
		userHandler:    users.NewHandler(authStore),
	}
}
