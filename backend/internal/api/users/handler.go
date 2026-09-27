package users

import (
	"context"
	"errors"
	"net/http"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/dsa-uts/dsa-project/backend/internal/store"
	"github.com/labstack/echo/v4"
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
	user := &store.UserAccount{Userid: req.Body.Userid, Name: req.Body.Name, Role: store.Role(req.Body.Role), PasswordHash: hash}
	if err := h.auth.CreateUser(ctx, user); err != nil {
		if errors.Is(err, store.ErrUseridTaken) {
			return nil, echo.NewHTTPError(
				http.StatusConflict,
				"This User ID is already taken.",
			)
		}
		return nil, err
	}
	return generated.CreateUserAccount201JSONResponse(userAccountResponse(user)), nil
}

func (h *Handler) UpdateUserAccount(ctx context.Context, req generated.UpdateUserAccountRequestObject) (generated.UpdateUserAccountResponseObject, error) {
	actor := httpauth.Actor(ctx)
	update := store.UserUpdate{Name: req.Body.Name, Disabled: req.Body.Disabled}
	if req.Body.Role != nil {
		update.Role = new(store.Role(*req.Body.Role))
	}
	if req.Body.Password != nil {
		hash, err := auth.HashPassword(*req.Body.Password)
		if err != nil {
			return nil, err
		}
		update.PasswordHash = new(hash)
	}
	user, err := h.auth.UpdateUser(ctx, actor.ID, req.UserId, update)
	switch {
	case errors.Is(err, store.ErrNotFound):
		return nil, echo.NewHTTPError(
			http.StatusNotFound,
			"User Account not found.",
		)
	case errors.Is(err, store.ErrCannotModifySelf):
		return nil, echo.NewHTTPError(
			http.StatusConflict,
			"You cannot modify yourself.",
		)
	case err != nil:
		return nil, err
	}
	return generated.UpdateUserAccount200JSONResponse(userAccountResponse(user)), nil
}

func (h *Handler) ReorderUserAccounts(ctx context.Context, req generated.ReorderUserAccountsRequestObject) (generated.ReorderUserAccountsResponseObject, error) {
	err := h.auth.ReorderUsers(ctx, req.Body.UserIds)
	if errors.Is(err, store.ErrUserIDsMismatch) {
		return nil, echo.NewHTTPError(
			http.StatusUnprocessableEntity,
			"User Accounts changed. Reload the complete list and reorder again.",
		)
	}
	if err != nil {
		return nil, err
	}
	return generated.ReorderUserAccounts204Response{}, nil
}
