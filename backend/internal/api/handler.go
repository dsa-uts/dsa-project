package api

import "github.com/dsa-uts/dsa-project/backend/internal/store"

// handler composes the feature handlers into the generated interface.
type handler struct {
	*sessionHandler
	*userHandler
}

var _ StrictServerInterface = (*handler)(nil)

func newHandler(authStore *store.AuthStore) *handler {
	return &handler{
		sessionHandler: &sessionHandler{auth: authStore},
		userHandler:    &userHandler{auth: authStore},
	}
}
