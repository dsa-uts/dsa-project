package admin

import (
	"context"
	"dsa-backend/handler/response"
	"net/http"

	"github.com/dsa-uts/dsa-project/database/model/userrole"
	"github.com/labstack/echo/v4"
)

type DeleteUserProps struct {
	UserID string `param:"user_id" validate:"required"`
}

// DeleteUser deletes a user by their user ID.
//
//	@Summary		Delete a user
//	@Description	Delete a user by their user ID. Cannot delete admin users.
//	@Tags			Admin
//	@Produce		json
//	@Param			user_id	path		string				true	"User ID of the user to be deleted"
//	@Success		200		{object}	response.Success	"User deleted successfully"
//	@Failure		400		{object}	response.Error		"Invalid request body or validation failed"
//	@Failure		403		{object}	response.Error		"Cannot delete an admin user"
//	@Failure		404		{object}	response.Error		"User not found"
//	@Failure		500		{object}	response.Error		"Failed to delete user"
//	@Security		OAuth2Password[admin]
//	@Router			/admin/delete/{user_id} [delete]
func (h *Handler) DeleteUser(c echo.Context) error {
	var props DeleteUserProps
	if err := c.Bind(&props); err != nil {
		return c.JSON(400, map[string]string{"error": "Invalid request"})
	}
	if err := c.Validate(&props); err != nil {
		return c.JSON(400, map[string]string{"error": "Validation failed"})
	}

	ctx := context.Background()

	// Check if user exists
	user, err := h.userStore.GetUserByUserID(ctx, props.UserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, response.NewError("Failed to check user existence: "+err.Error()))
	}
	if user == nil {
		return c.JSON(http.StatusNotFound, response.NewError("User not found"))
	}

	if user.RoleID == userrole.Admin {
		return c.JSON(http.StatusForbidden, response.NewError("Cannot delete the admin user"))
	}

	// TODO: Fetch all files associated with the user and delete them
	// This includes:
	// - ValidationRequest
	// - GradingRequest

	// At now, we just delete the user entry.
	if err := h.userStore.DeleteUserByUserID(ctx, props.UserID); err != nil {
		return c.JSON(http.StatusInternalServerError, response.NewError("Failed to delete user: "+err.Error()))
	}

	return c.JSON(http.StatusOK, response.NewSuccess("User deleted successfully"))
}
