package users

import (
	"context"
	"errors"
	"log/slog"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpresponse"
	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
)

// Handler implements Admin User Account operations.
type Handler struct{ auth *store.AuthStore }

func NewHandler(authStore *store.AuthStore) *Handler {
	return &Handler{auth: authStore}
}

func userAccountResponse(user *store.UserAccount) generated.UserAccount {
	return generated.UserAccount{Id: user.ID, Userid: user.Userid, Name: user.Name, Role: generated.UserRole(user.Role), Disabled: user.DisabledAt != nil}
}

func (h *Handler) ListUserAccounts(ctx context.Context, req generated.ListUserAccountsRequestObject) (generated.ListUserAccountsResponseObject, error) {
	users, err := h.auth.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]generated.UserAccount, 0, len(users))
	for i := range users {
		result = append(result, userAccountResponse(&users[i]))
	}
	return generated.ListUserAccounts200JSONResponse{Users: result}, nil
}

func (h *Handler) CreateUserAccount(ctx context.Context, req generated.CreateUserAccountRequestObject) (generated.CreateUserAccountResponseObject, error) {
	hash, err := auth.HashPassword(req.Body.Password)
	if err != nil {
		return nil, err
	}
	user := &store.UserAccount{Userid: req.Body.Userid, Name: req.Body.Name, Role: string(req.Body.Role), PasswordHash: &hash}
	if err := h.auth.CreateUser(ctx, user); errors.Is(err, store.ErrUseridTaken) {
		return generated.CreateUserAccount409JSONResponse{generated.UserConflictJSONResponse(httpresponse.NewError("userid_taken", "This User ID is already taken."))}, nil
	} else if err != nil {
		slog.ErrorContext(ctx, "create User Account", "error", err)
		return nil, err
	}
	return generated.CreateUserAccount201JSONResponse(userAccountResponse(user)), nil
}

func (h *Handler) UpdateUserAccount(ctx context.Context, req generated.UpdateUserAccountRequestObject) (generated.UpdateUserAccountResponseObject, error) {
	actor := httpauth.Actor(ctx)
	update := store.UserUpdate{Name: req.Body.Name, Disabled: req.Body.Disabled}
	if req.Body.Role != nil {
		role := string(*req.Body.Role)
		update.Role = &role
	}
	if req.Body.Password != nil {
		hash, err := auth.HashPassword(*req.Body.Password)
		if err != nil {
			return nil, err
		}
		update.PasswordHash = &hash
	}
	user, err := h.auth.UpdateUser(ctx, actor.ID, req.UserId, update)
	switch {
	case errors.Is(err, store.ErrNotFound):
		return generated.UpdateUserAccount404JSONResponse{generated.NotFoundJSONResponse(httpresponse.NewError("not_found", "User Account not found."))}, nil
	case errors.Is(err, store.ErrCannotModifySelf), errors.Is(err, store.ErrCannotModifySystemAccount):
		return generated.UpdateUserAccount409JSONResponse{generated.UserConflictJSONResponse(httpresponse.NewError(err.Error(), "This User Account cannot be modified in that way."))}, nil
	case err != nil:
		slog.ErrorContext(ctx, "update User Account", "error", err)
		return nil, err
	}
	return generated.UpdateUserAccount200JSONResponse(userAccountResponse(user)), nil
}
