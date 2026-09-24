package validation

import (
	"errors"
	"fmt"
	"mime"
	"net/http"

	"github.com/dsa-uts/dsa-project/backend/internal/api/httpresponse"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	echomiddleware "github.com/oapi-codegen/echo-middleware"
)

func init() {
	// kin-openapi does not enable UUID validation by default. Since v0.148.0,
	// registered validators also apply to OpenAPI 3.1. Register once,
	// before serving requests, so invalid path parameters produce 422 here
	// instead of 400 from generated UUID binding after this middleware.
	openapi3.DefineStringFormatValidator("uuid", openapi3.NewCallbackValidator(uuid.Validate))
}

func RequestValidator(spec *openapi3.T, authenticate openapi3filter.AuthenticationFunc) echo.MiddlewareFunc {
	return echomiddleware.OapiRequestValidatorWithOptions(spec, &echomiddleware.Options{
		Options:      openapi3filter.Options{AuthenticationFunc: authenticate},
		ErrorHandler: validationErrorHandler,
	})
}

func validationErrorHandler(c echo.Context, err *echo.HTTPError) error {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return echo.NewHTTPError(http.StatusRequestEntityTooLarge, httpresponse.NewError("payload_too_large", "HTTP body exceeds 21,000,000 bytes.")).SetInternal(err)
	}
	var requestError *openapi3filter.RequestError
	if errors.As(err, &requestError) && requestError.RequestBody != nil {
		content := requestError.RequestBody.Content
		media, _, parseErr := mime.ParseMediaType(c.Request().Header.Get("Content-Type"))
		if len(content) > 0 && (parseErr != nil || content.Get(media) == nil) {
			return echo.NewHTTPError(http.StatusUnsupportedMediaType, httpresponse.NewError("unsupported_media_type", "Content-Type is not supported by this operation.")).SetInternal(err)
		}
	}
	// Keep the public API's 422 envelope for invalid input; authentication and
	// routing errors retain their original status through the HTTP error handler.
	if err.Code == http.StatusBadRequest {
		return echo.NewHTTPError(http.StatusUnprocessableEntity, httpresponse.NewError("validation_failed", fmt.Sprint(err.Message))).SetInternal(err)
	}
	return err
}
