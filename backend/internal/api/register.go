package api

import (
	"fmt"
	"net/http"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpresponse"
	"github.com/dsa-uts/dsa-project/backend/internal/resourceimport"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

// NewHandler assembles API handlers, authorization, and contract validation.
func NewHandler(
	accountStore *store.AccountStore,
	projectStore *store.ProjectStore,
	requestStore *store.RequestStore,
	source *resourceimport.Source,
) http.Handler {
	spec, err := generated.GetSpec()
	if err != nil {
		panic(fmt.Sprintf("load embedded openapi spec: %v", err))
	}
	// Deployment hosts are not part of request validation.
	spec.Servers = nil
	if err := httpauth.ValidateAccessPolicies(spec); err != nil {
		panic(fmt.Sprintf("invalid API access policy: %v", err))
	}
	strict := generated.NewStrictHandlerWithOptions(
		newHandler(accountStore, projectStore, requestStore, source),
		nil,
		generated.StrictHTTPServerOptions{
			RequestErrorHandlerFunc:  httpresponse.BadRequest,
			ResponseErrorHandlerFunc: httpresponse.ErrorHandler,
		},
	)
	return generated.HandlerWithOptions(strict, generated.StdHTTPServerOptions{
		BaseRouter: &validatingMux{
			ServeMux: http.NewServeMux(),
			spec:     spec,
			accounts: accountStore,
		},
		Middlewares:      []generated.MiddlewareFunc{httpresponse.TrackResponse},
		ErrorHandlerFunc: httpresponse.BadRequest,
	})
}
