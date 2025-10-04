package admin

import (
	"context"
	"dsa-backend/handler/response"
	"net/http"
	"time"

	"github.com/dsa-uts/dsa-project/database/model/userrole"
	"github.com/labstack/echo/v4"
)

type archiveUserRequest struct {
	UserID string `param:"user_id" validate:"required"`
}

// ArchiveUser archives a user by setting their DisabledAt to the current time.
//
//	@Summary		Archive a user
//	@Description	Archive a user by setting their DisabledAt to the current time.
//	@Tags			Admin
//	@Produce		json
//	@Param			user_id	path		string				true	"User ID"
//	@Success		200		{object}	response.Success	"User archived successfully"
//	@Failure		400		{object}	response.Error		"Invalid request body or validation failed"
//	@Failure		403		{object}	response.Error		"Cannot archive an admin user"
//	@Failure		404		{object}	response.Error		"User not found"
//	@Failure		500		{object}	response.Error		"Failed to archive user"
//	@Security		OAuth2Password[admin]
//	@Router			/admin/archive/{user_id} [patch]
func (h *Handler) ArchiveUser(c echo.Context) error {
	ctx := context.Background()

	var req archiveUserRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, response.NewError("Invalid request body: "+err.Error()))
	}
	if err := c.Validate(&req); err != nil {
		return c.JSON(http.StatusBadRequest, response.NewError("Validation failed: "+err.Error()))
	}

	// Check if user exists
	user, err := h.userStore.GetUserByUserID(ctx, req.UserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, response.NewError("Failed to check user existence: "+err.Error()))
	}
	if user == nil {
		return c.JSON(http.StatusNotFound, response.NewError("User not found"))
	}

	// Validation: Prevent archiving the last admin user
	if user.RoleID == userrole.Admin {
		return c.JSON(http.StatusForbidden, response.NewError("Cannot archive an admin user"))
	}

	// Modify user's DisabledAt to current time
	if err := h.userStore.ModifyUserValidity(ctx, req.UserID, time.Now()); err != nil {
		return c.JSON(http.StatusInternalServerError, response.NewError("Failed to archive user: "+err.Error()))
	}

	return c.JSON(http.StatusOK, response.NewSuccess("User archived successfully"))
}

// ActivateUser activates a user by setting their DisabledAt to a future date.
//
//	@Summary		Activate a user
//	@Description	Activate a user by setting their DisabledAt to a future date.
//	@Tags			Admin
//	@Produce		json
//	@Param			user_id	path		string				true	"User ID"
//	@Success		200		{object}	response.Success	"User activated successfully"
//	@Failure		400		{object}	response.Error		"Invalid request body or validation failed"
//	@Failure		403		{object}	response.Error		"Cannot modify an admin user"
//	@Failure		404		{object}	response.Error		"User not found"
//	@Failure		500		{object}	response.Error		"Failed to activate user"
//	@Security		OAuth2Password[admin]
//	@Router			/admin/activate/{user_id} [patch]
func (h *Handler) ActivateUser(c echo.Context) error {
	ctx := context.Background()

	var req archiveUserRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, response.NewError("Invalid request body: "+err.Error()))
	}
	if err := c.Validate(&req); err != nil {
		return c.JSON(http.StatusBadRequest, response.NewError("Validation failed: "+err.Error()))
	}

	// Check if user exists
	user, err := h.userStore.GetUserByUserID(ctx, req.UserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, response.NewError("Failed to check user existence: "+err.Error()))
	}
	if user == nil {
		return c.JSON(http.StatusNotFound, response.NewError("User not found"))
	}

	// Validation: Prevent modifying the admin user
	if user.RoleID == userrole.Admin {
		return c.JSON(http.StatusForbidden, response.NewError("Cannot modify an admin user"))
	}

	// Modify user's DisabledAt to a future date
	if err := h.userStore.ModifyUserValidity(ctx, req.UserID, time.Date(2100, 12, 31, 23, 59, 59, 0, time.UTC)); err != nil {
		return c.JSON(http.StatusInternalServerError, response.NewError("Failed to activate user: "+err.Error()))
	}

	return c.JSON(http.StatusOK, response.NewSuccess("User activated successfully"))
}
