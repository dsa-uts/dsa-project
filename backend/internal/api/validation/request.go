package validation

import (
	"errors"
	"fmt"
	"mime"
	"net/http"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
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
		return c.JSON(http.StatusRequestEntityTooLarge, httpresponse.NewError("payload_too_large", "HTTP body exceeds 21,000,000 bytes."))
	}
	if body, ok := err.Message.(generated.Error); ok {
		return c.JSON(err.Code, body)
	}
	var requestError *openapi3filter.RequestError
	if errors.As(err, &requestError) && requestError.RequestBody != nil {
		content := requestError.RequestBody.Content
		media, _, parseErr := mime.ParseMediaType(c.Request().Header.Get("Content-Type"))
		if len(content) > 0 && (parseErr != nil || content.Get(media) == nil) {
			return c.JSON(http.StatusUnsupportedMediaType, httpresponse.NewError("unsupported_media_type", "Content-Type is not supported by this operation."))
		}
	}
	// Keep the public API's 422 envelope for invalid input; authentication and
	// routing errors retain their original status through the HTTP error handler.
	if err.Code == http.StatusBadRequest {
		return c.JSON(http.StatusUnprocessableEntity, httpresponse.NewError("validation_failed", fmt.Sprint(err.Message)))
	}
	return err
}
