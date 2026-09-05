package api

import (
	"context"
	"errors"
	"log/slog"

	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/labstack/echo/v4"
)

type userHandler struct{ auth *store.AuthStore }

// userOperationMiddlewares keeps authorization policy beside the operations.
func userOperationMiddlewares(authStore *store.AuthStore) map[string][]echo.MiddlewareFunc {
	admin := requireAdmin(authStore)
	return map[string][]echo.MiddlewareFunc{
		"listUserAccounts":  {admin},
		"createUserAccount": {admin},
		"updateUserAccount": {admin},
	}
}

func userAccountResponse(user *store.UserAccount) UserAccount {
	return UserAccount{Id: user.ID, Userid: user.Userid, Name: user.Name, Role: UserRole(user.Role), Disabled: user.DisabledAt != nil}
}

func (h *userHandler) ListUserAccounts(ctx context.Context, req ListUserAccountsRequestObject) (ListUserAccountsResponseObject, error) {
	users, err := h.auth.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]UserAccount, 0, len(users))
	for i := range users {
		result = append(result, userAccountResponse(&users[i]))
	}
	return ListUserAccounts200JSONResponse{Users: result}, nil
}

func (h *userHandler) CreateUserAccount(ctx context.Context, req CreateUserAccountRequestObject) (CreateUserAccountResponseObject, error) {
	hash, err := auth.HashPassword(req.Body.Password)
	if err != nil {
		return nil, err
	}
	user := &store.UserAccount{Userid: req.Body.Userid, Name: req.Body.Name, Role: string(req.Body.Role), PasswordHash: &hash}
	if err := h.auth.CreateUser(ctx, user); errors.Is(err, store.ErrUseridTaken) {
		return CreateUserAccount409JSONResponse{UserConflictJSONResponse(NewError("userid_taken", "This User ID is already taken."))}, nil
	} else if err != nil {
		slog.ErrorContext(ctx, "create User Account", "error", err)
		return nil, err
	}
	return CreateUserAccount201JSONResponse(userAccountResponse(user)), nil
}

func (h *userHandler) UpdateUserAccount(ctx context.Context, req UpdateUserAccountRequestObject) (UpdateUserAccountResponseObject, error) {
	actor := adminActor(ctx)
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
		return UpdateUserAccount404JSONResponse{NotFoundJSONResponse(NewError("not_found", "User Account not found."))}, nil
	case errors.Is(err, store.ErrCannotModifySelf), errors.Is(err, store.ErrCannotModifySystemAccount):
		return UpdateUserAccount409JSONResponse{UserConflictJSONResponse(NewError(err.Error(), "This User Account cannot be modified in that way."))}, nil
	case err != nil:
		slog.ErrorContext(ctx, "update User Account", "error", err)
		return nil, err
	}
	return UpdateUserAccount200JSONResponse(userAccountResponse(user)), nil
}
