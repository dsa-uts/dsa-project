package admin

import (
	"context"
	"dsa-backend/handler/response"
	"net/http"
	"time"

	"github.com/dsa-uts/dsa-project/database/model"
	"github.com/dsa-uts/dsa-project/database/model/userrole"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

type registerUserRequest struct {
	UserID   string `json:"user_id" validate:"required,alphanum"`
	Name     string `json:"name" validate:"required,min=1,max=30"`
	Password string `json:"password" validate:"required,min=8,max=100"`
	Email    string `json:"email" validate:"omitempty,email"`
	Role     string `json:"role" validate:"required,oneof=admin manager student"`
}

// RegisterUser registers a new user.
//
//	@Summary		Register a new user
//	@Description	Register a new user with the provided details.
//	@Tags			Admin
//	@Accept			json
//	@Produce		json
//	@Param			user	body		registerUserRequest	true	"User registration details"
//	@Success		201		{object}	response.Success	"User registered successfully"
//	@Failure		400		{object}	response.Error		"Invalid request body or validation failed"
//	@Failure		409		{object}	response.Error		"User ID already exists"
//	@Failure		500		{object}	response.Error		"Failed to create user"
//	@Security		OAuth2Password[admin]
//	@Router			/admin/register [post]
func (h *Handler) RegisterUser(c echo.Context) error {
	ctx := context.Background()

	var req registerUserRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, response.NewError("Invalid request body: "+err.Error()))
	}
	if err := c.Validate(&req); err != nil {
		return c.JSON(http.StatusBadRequest, response.NewError("Validation failed: "+err.Error()))
	}

	// convert role string to role id
	roleID, ok := userrole.RoleNameToUserRole()[userrole.RoleName(req.Role)]
	if !ok {
		return c.JSON(http.StatusBadRequest, response.NewError("Invalid role"))
	}

	// Check if admin is trying to create another admin
	if roleID == userrole.Admin {
		return c.JSON(http.StatusForbidden, response.NewError("Cannot create another admin user"))
	}

	// Check if user already exists
	exists, err := h.userStore.ExistsByUserID(c.Request().Context(), req.UserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, response.NewError("Failed to check user existence: "+err.Error()))
	}
	if exists {
		return c.JSON(http.StatusConflict, response.NewError("User already exists"))
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, response.NewError("Failed to hash password: "+err.Error()))
	}

	// create user
	newUser := &model.UserList{
		UserID:         req.UserID,
		Name:           req.Name,
		HashedPassword: string(hashedPassword),
		RoleID:         roleID,
		DisabledAt:     time.Date(2100, 12, 31, 23, 59, 59, 0, time.UTC), // default to not disabled
		Email:          &req.Email,
	}

	if err := h.userStore.CreateUser(ctx, newUser); err != nil {
		return c.JSON(http.StatusInternalServerError, response.NewError("Failed to create user: "+err.Error()))
	}

	return c.JSON(http.StatusCreated, response.NewSuccess("User created successfully"))
}
