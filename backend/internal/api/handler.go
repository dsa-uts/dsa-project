package api

import (
	"github.com/dsa-uts/dsa-project/backend/internal/api/admin/users"
	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/sessions"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

// Local aliases give the embedded feature handlers distinct field names.
type sessionHandler = sessions.Handler
type userHandler = users.Handler

// handler composes the feature handlers into the generated interface.
type handler struct {
	*sessionHandler
	*userHandler
}

var _ generated.StrictServerInterface = (*handler)(nil)

func newHandler(authStore *store.AuthStore) *handler {
	return &handler{
		sessionHandler: sessions.NewHandler(authStore),
		userHandler:    users.NewHandler(authStore),
	}
}
