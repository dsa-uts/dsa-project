package api

import (
	"errors"
	"mime"
	"net/http"
	"strings"

	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpresponse"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/google/uuid"
)

func init() {
	openapi3.DefineStringFormatValidator("uuid", openapi3.NewCallbackValidator(uuid.Validate))
}

// validatingMux wraps generated routes before parameter binding, using ServeMux's
// own path matching so authentication and dispatch always agree on the operation.
type validatingMux struct {
	*http.ServeMux
	spec     *openapi3.T
	accounts *store.AccountStore
}

func (m *validatingMux) HandleFunc(
	pattern string,
	handler func(http.ResponseWriter, *http.Request),
) {
	method, path, _ := strings.Cut(pattern, " ")
	pathItem := m.spec.Paths.Value(path)
	route := &routers.Route{
		Spec:      m.spec,
		Path:      path,
		PathItem:  pathItem,
		Method:    method,
		Operation: pathItem.GetOperation(method),
	}
	m.ServeMux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if media, params, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err == nil {
			r.Header.Set("Content-Type", mime.FormatMediaType(media, params))
		}
		params := make(map[string]string)
		for _, definitions := range []openapi3.Parameters{pathItem.Parameters, route.Operation.Parameters} {
			for _, definition := range definitions {
				if p := definition.Value; p.In == openapi3.ParameterInPath {
					params[p.Name] = r.PathValue(p.Name)
				}
			}
		}
		input := &openapi3filter.RequestValidationInput{
			Request:    r,
			PathParams: params,
			Route:      route,
			Options: &openapi3filter.Options{
				AuthenticationFunc: httpauth.Authenticate(m.accounts, w),
			},
		}
		if err := openapi3filter.ValidateRequest(r.Context(), input); err != nil {
			if _, ok := errors.AsType[*openapi3filter.SecurityRequirementsError](err); ok {
				httpresponse.ErrorHandler(w, r, err)
			} else {
				httpresponse.BadRequest(w, r, err)
			}
			return
		}
		handler(w, r)
	})
}
