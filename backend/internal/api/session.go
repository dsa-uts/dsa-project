package api

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"

	"golang.org/x/crypto/bcrypt"

	"github.com/dsa-uts/dsa-project/backend/internal/auth"
)

func invalidCredentials() Error {
	// userid 不存在とパスワード誤りを区別しない (api.md / issue #96)
	return NewError("invalid_credentials", "Invalid userid or password.")
}

// dummyHash is compared against when the userid does not exist, so that the
// request duration does not reveal whether the userid exists (bcrypt の比較
// コストを両分岐で揃える)。
var dummyHash = func() []byte {
	h, err := bcrypt.GenerateFromPassword([]byte("dummy"), bcrypt.DefaultCost)
	if err != nil {
		panic(err)
	}
	return h
}()

func (h *Handler) CreateSession(ctx context.Context, req CreateSessionRequestObject) (CreateSessionResponseObject, error) {
	if h.users == nil || h.sessions == nil {
		return CreateSession500JSONResponse{InternalErrorJSONResponse(storeUnavailable())}, nil
	}

	user, err := h.users.GetByUserid(ctx, req.Body.Userid)
	if errors.Is(err, sql.ErrNoRows) {
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(req.Body.Password))
		return CreateSession401JSONResponse{UnauthorizedJSONResponse(invalidCredentials())}, nil
	}
	if err != nil {
		slog.ErrorContext(ctx, "look up user for login", "error", err)
		return CreateSession500JSONResponse{InternalErrorJSONResponse(NewError("internal", "Failed to create session."))}, nil
	}

	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Body.Password)) != nil {
		return CreateSession401JSONResponse{UnauthorizedJSONResponse(invalidCredentials())}, nil
	}
	// Disabled User Account はログイン不可 (CONTEXT.md)。存在を漏らさないため
	// credential 不正と同じ応答にする。
	if user.Disabled {
		return CreateSession401JSONResponse{UnauthorizedJSONResponse(invalidCredentials())}, nil
	}

	token, err := h.sessions.Create(ctx, user.ID)
	if err != nil {
		slog.ErrorContext(ctx, "create session", "error", err)
		return CreateSession500JSONResponse{InternalErrorJSONResponse(NewError("internal", "Failed to create session."))}, nil
	}

	cookie := auth.NewCookie(token).String()
	return CreateSession200JSONResponse{
		Body:    apiUser(user),
		Headers: CreateSession200ResponseHeaders{SetCookie: &cookie},
	}, nil
}

func (h *Handler) DeleteSession(ctx context.Context, _ DeleteSessionRequestObject) (DeleteSessionResponseObject, error) {
	// 冪等: セッションが無くても 204 (api.md)。cookie は常に失効させる。
	if token, ok := auth.SessionToken(ctx); ok && h.sessions != nil {
		if err := h.sessions.Delete(ctx, token); err != nil {
			slog.ErrorContext(ctx, "delete session", "error", err)
			return DeleteSession500JSONResponse{InternalErrorJSONResponse(NewError("internal", "Failed to delete session."))}, nil
		}
	}
	cookie := auth.ExpiredCookie().String()
	return DeleteSession204Response{Headers: DeleteSession204ResponseHeaders{SetCookie: &cookie}}, nil
}

func (h *Handler) GetMe(ctx context.Context, _ GetMeRequestObject) (GetMeResponseObject, error) {
	user := auth.CurrentUser(ctx)
	if user == nil {
		return GetMe401JSONResponse{UnauthorizedJSONResponse(NewError("unauthenticated", "No valid session."))}, nil
	}

	headers := GetMe200ResponseHeaders{}
	// sliding session: Redis 側の TTL 延長 (middleware) に合わせて cookie の
	// Max-Age も更新する。
	if token, ok := auth.SessionToken(ctx); ok {
		cookie := auth.NewCookie(token).String()
		headers.SetCookie = &cookie
	}
	return GetMe200JSONResponse{Body: apiUser(user), Headers: headers}, nil
}
