package api

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

// Handler implements the generated StrictServerInterface.
type Handler struct {
	// nil のときは DB 未接続 (DATABASE_URL 未設定)。manifest に PostgreSQL が
	// 入るまでの scaffolding 期の妥協で、DB を使う操作は 500 を返す。
	greetings *store.GreetingStore
}

var _ StrictServerInterface = (*Handler)(nil)

func NewHandler(greetings *store.GreetingStore) *Handler {
	return &Handler{greetings: greetings}
}

// NewError builds the api.md unified error envelope.
func NewError(code, message string) Error {
	var e Error
	e.Error.Code = code
	e.Error.Message = message
	return e
}

func databaseUnavailable() Error {
	return NewError("database_unavailable", "The server is running without a database connection.")
}

func (h *Handler) ListGreetings(ctx context.Context, _ ListGreetingsRequestObject) (ListGreetingsResponseObject, error) {
	if h.greetings == nil {
		return ListGreetings500JSONResponse{InternalErrorJSONResponse(databaseUnavailable())}, nil
	}
	rows, err := h.greetings.List(ctx)
	if err != nil {
		slog.ErrorContext(ctx, "list greetings", "error", err)
		return ListGreetings500JSONResponse{InternalErrorJSONResponse(NewError("internal", "Failed to list greetings."))}, nil
	}
	greetings := make([]Greeting, 0, len(rows))
	for _, r := range rows {
		greetings = append(greetings, Greeting{Id: r.ID, Message: r.Message, CreatedAt: r.CreatedAt})
	}
	return ListGreetings200JSONResponse(GreetingList{Greetings: greetings}), nil
}

func (h *Handler) CreateGreeting(ctx context.Context, req CreateGreetingRequestObject) (CreateGreetingResponseObject, error) {
	if h.greetings == nil {
		return CreateGreeting500JSONResponse{InternalErrorJSONResponse(databaseUnavailable())}, nil
	}
	g, err := h.greetings.Create(ctx, fmt.Sprintf("hello, %s", req.Body.Name))
	if err != nil {
		slog.ErrorContext(ctx, "create greeting", "error", err)
		return CreateGreeting500JSONResponse{InternalErrorJSONResponse(NewError("internal", "Failed to create greeting."))}, nil
	}
	return CreateGreeting201JSONResponse(Greeting{Id: g.ID, Message: g.Message, CreatedAt: g.CreatedAt}), nil
}
