package response

type Success struct {
	Msg string `json:"message"`
}

func NewSuccess(msg string) Success {
	return Success{
		Msg: msg,
	}
}

type Error struct {
	Errors struct {
		Body string `json:"body"`
	} `json:"errors"`
}

func NewError(msg string) Error {
	return Error{
		Errors: struct {
			Body string `json:"body"`
		}{
			Body: msg,
		},
	}
}
