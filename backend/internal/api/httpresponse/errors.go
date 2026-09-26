package httpresponse

import "github.com/dsa-uts/dsa-project/backend/internal/api/generated"

var ValidationErrorCode = "validation_failed"
var NotFoundErrorCode = "not_found"
var ForbiddenErrorCode = "forbidden"

var IdempotencyKeyConflictErrorCode = "idempotency_key_conflict"

// NewError builds an application error with a machine-readable code.
func NewError(code, message string) generated.Error {
	return generated.Error{Code: &code, Message: message}
}
