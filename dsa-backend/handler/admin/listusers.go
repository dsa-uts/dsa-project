package admin

import (
	"context"
	"time"

	"github.com/dsa-uts/dsa-project/database/model/userrole"
	"github.com/labstack/echo/v4"
)

type UserInfo struct {
	UserID   string `json:"user_id"`
	Name     string `json:"name"`
	Email    string `json:"email,omitempty"`
	Role     string `json:"role"`
	Archived bool   `json:"archived"`
}

type ListUserResponse struct {
	Users []UserInfo `json:"users"`
}

// ListUsers lists all users.
//
//	@Summary		List all users
//	@Description	Retrieve a list of all users with their details.
//	@Tags			Admin
//	@Produce		json
//	@Success		200	{object}	ListUserResponse	"List of users retrieved successfully"
//	@Failure		500	{object}	response.Error		"Failed to get user list"
//	@Security		OAuth2Password[admin]
//	@Router			/admin/users [get]
func (h *Handler) ListUsers(c echo.Context) error {
	ctx := context.Background()

	users, err := h.userStore.GetAllUserList(ctx)

	if err != nil || users == nil {
		return c.JSON(500, "Failed to get user list")
	}

	response := make([]UserInfo, 0, len(*users))

	for _, user := range *users {
		role_str, ok := userrole.RoleIDToUserRole()[user.RoleID]
		if !ok {
			role_str = "unknown"
		}
		var email string = ""
		if user.Email != nil {
			email = *user.Email
		}
		archived := (user.DisabledAt.Before(time.Now()))

		response = append(response, UserInfo{
			UserID:   user.UserID,
			Name:     user.Name,
			Email:    email,
			Role:     string(role_str),
			Archived: archived,
		})
	}

	return c.JSON(200, ListUserResponse{Users: response})
}
