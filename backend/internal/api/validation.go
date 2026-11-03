package api

import (
	"context"
	"errors"
	"mime"
	"net/http"

	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpresponse"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/google/uuid"
	middleware "github.com/oapi-codegen/nethttp-middleware"
)

func init() {
	openapi3.DefineStringFormatValidator("uuid", openapi3.NewCallbackValidator(uuid.Validate))
}

func validateAPI(spec *openapi3.T, accounts *store.AccountStore, next http.Handler) http.Handler {
	// ServeMux accepts HEAD wherever GET is registered; validate it with the same policy.
	for _, item := range spec.Paths.Map() {
		if item.Head == nil {
			item.Head = item.Get
		}
	}
	handler := middleware.OapiRequestValidatorWithOptions(spec, &middleware.Options{
		Options: openapi3filter.Options{
			AuthenticationFunc: httpauth.Authenticate(accounts),
		},
		ErrorHandlerWithOpts: validationError,
	})(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if media, params, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err == nil {
			r.Header.Set("Content-Type", mime.FormatMediaType(media, params))
		}
		handler.ServeHTTP(w, r)
	})
}

func validationError(
	_ context.Context,
	err error,
	w http.ResponseWriter,
	r *http.Request,
	opts middleware.ErrorHandlerOpts,
) {
	switch {
	case errors.Is(err, routers.ErrMethodNotAllowed):
		// ErrorHandlerWithOpts suggests 404 for all route lookup failures.
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
	case errors.Is(err, routers.ErrPathNotFound):
		http.NotFound(w, r)
	default:
		if _, ok := errors.AsType[*openapi3filter.SecurityRequirementsError](err); ok {
			if failure, ok := errors.AsType[*httpresponse.Error](
				err,
			); ok &&
				failure.Code == http.StatusUnauthorized {
				w.Header().Set("Set-Cookie", httpauth.ClearedSessionCookie())
			}
			httpresponse.ErrorHandler(w, r, err)
		} else if opts.StatusCode == http.StatusBadRequest {
			httpresponse.BadRequest(w, r, err)
		} else {
			httpresponse.ErrorHandler(w, r, err)
		}
	}
}
