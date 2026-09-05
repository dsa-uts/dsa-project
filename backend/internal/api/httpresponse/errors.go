package httpresponse

import "github.com/dsa-uts/dsa-project/backend/internal/api/generated"

// NewError builds the api.md unified error envelope.
func NewError(code, message string) generated.Error {
	var e generated.Error
	e.Error.Code = code
	e.Error.Message = message
	return e
}
