package api

// NewError builds the api.md unified error envelope.
func NewError(code, message string) Error {
	var e Error
	e.Error.Code = code
	e.Error.Message = message
	return e
}
