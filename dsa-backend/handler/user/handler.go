package user

import (
	"context"
	"dsa-backend/handler/auth"
	"dsa-backend/handler/middleware"
	"dsa-backend/handler/response"
	"net/http"
	"time"

	"github.com/dsa-uts/dsa-project/database"
	"github.com/dsa-uts/dsa-project/database/model"
	"github.com/labstack/echo/v4"
	"github.com/uptrace/bun"
	"golang.org/x/crypto/bcrypt"
)

type userLoginRequest struct {
	UserId   string `form:"username" validate:"required"`
	Password string `form:"password" validate:"required"`
}

func (r *userLoginRequest) bind(c echo.Context) error {
	if err := c.Bind(r); err != nil {
		return err
	}
	if err := c.Validate(r); err != nil {
		return err
	}
	return nil
}

type userResponse struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Email *string `json:"email,omitempty"`
}

type userLoginResponse struct {
	Token     string       `json:"access_token"` // DO NOT modify json name, 'access_token' is required in Swagger UI
	TokenType string       `json:"token_type"`   // DO NOT modify json name, 'token_type' is required in Swagger UI
	ExpiredAt int64        `json:"exp"`
	User      userResponse `json:"user"`
}

type Handler struct {
	db        *bun.DB
	userStore database.UserStore
	jwtSecret string
}

func NewUserHandler(jwtSecret string, db *bun.DB) *Handler {
	return &Handler{
		db:        db,
		userStore: *database.NewUserStore(db),
		jwtSecret: jwtSecret,
	}
}

func (h *Handler) RegisterRoutes(r *echo.Group) {
	r.POST("/login", h.Login)

	r.GET("/me", h.GetCurrentUser, middleware.JWTMiddleware(h.jwtSecret), middleware.CheckValidityOfJWTMiddleware(h.db))
	r.POST("/logout", h.Logout, middleware.JWTMiddleware(h.jwtSecret), middleware.CheckValidityOfJWTMiddleware(h.db))
}

// Login godoc
//
//	@Summary		User Login
//	@Description	User login with user ID and password. Returns a JWT token if successful.
//	@Tags			User
//	@Accept			x-www-form-urlencoded
//	@Product		json
//	@param			username	formData	string				true	"User ID"
//	@param			password	formData	string				true	"Password"
//	@Success		200			{object}	userLoginResponse	"Login successful. Returns a JWT token."
//	@Failure		400			{object}	response.Error		"Bad request. This error occurs if the user ID or password is missing or incorrect."
//	@Failure		500			{string}	response.Error		"Internal server error. This error occurs if there is an issue with the database or password hashing."
//	@Router			/user/login [post]
func (h *Handler) Login(c echo.Context) error {
	ctx := context.Background()

	var loginRequest userLoginRequest
	err := loginRequest.bind(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, response.NewError("failed to bind request: "+err.Error()))
	}

	plain_password := loginRequest.Password

	userRecord, err := h.userStore.GetUserByUserID(ctx, loginRequest.UserId)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, response.NewError("failed to get user: "+err.Error()))
	}

	if userRecord == nil {
		return c.JSON(http.StatusBadRequest, response.NewError("user not found"))
	}

	hashed_password := userRecord.HashedPassword

	// Verify provided password against the stored hashed password
	err = bcrypt.CompareHashAndPassword([]byte(hashed_password), []byte(plain_password))

	if err != nil {
		return c.JSON(http.StatusBadRequest, response.NewError("wrong userid or password"))
	}

	// get user role
	userRoleID := userRecord.RoleID
	userRoleName := userRecord.UserRole.Name
	// get user scopes
	scopes, err := auth.GetUserScopes(userRoleID)

	if err != nil {
		return c.String(http.StatusInternalServerError, "invalid user role: "+string(userRoleName))
	}

	issuedAt := time.Now()
	expiredAt := issuedAt.Add(time.Hour * 12) // 12 hours expiration

	// register LoginHistory
	{
		err := h.userStore.RegisterLoginHistory(ctx, &model.LoginHistory{
			UserID:   userRecord.UserID,
			LoginAt:  issuedAt,
			LogoutAt: expiredAt,
		})

		if err != nil {
			return c.JSON(http.StatusInternalServerError, response.NewError("failed to register login history: "+err.Error()))
		}
	}

	// create JWT token
	token, err := auth.IssueNewToken(userRecord.ID, userRecord.UserID, scopes, h.jwtSecret, issuedAt, expiredAt)

	if err != nil {
		return c.String(http.StatusInternalServerError, "failed to issue token")
	}

	return c.JSON(http.StatusOK, userLoginResponse{
		Token:     token,
		TokenType: "bearer",
		ExpiredAt: expiredAt.Unix(),
		User: userResponse{
			ID:    userRecord.UserID,
			Name:  userRecord.Name,
			Email: userRecord.Email,
		},
	})
}

// GetCurrentUser godoc
//
//	@Summary		Get current user information
//	@Description	Get current user information from JWT token
//	@Tags			User
//	@Product		json
//	@Success		200	{object}	userResponse	"Current user information"
//	@Failure		401	{object}	response.Error	"Unauthorized"
//	@Failure		500	{string}	response.Error	"Internal server error"
//	@Security		OAuth2Password[me]
//	@Router			/user/me [get]
func (h *Handler) GetCurrentUser(c echo.Context) error {
	ctx := context.Background()
	// Get userID from jwt token
	claim, err := auth.GetJWTClaims(&c)
	if err != nil {
		return err
	}

	// Get User data from db
	userRecord, err := h.userStore.GetUserByUserID(ctx, claim.UserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, response.NewError("failed to get user: "+err.Error()))
	}

	if userRecord == nil {
		return c.JSON(http.StatusUnauthorized, response.NewError("user not found"))
	}

	return c.JSON(http.StatusOK, userResponse{
		ID:    userRecord.UserID,
		Name:  userRecord.Name,
		Email: userRecord.Email,
	})
}

// Logout godoc
//
//	@Summary		Logout user
//	@Description	Logout user and invalidate JWT token
//	@Tags			User
//	@Product		json
//	@Success		200	{object}	response.Success	"Logout successful"
//	@Failure		401	{object}	response.Error		"Unauthorized"
//	@Failure		500	{string}	response.Error		"Internal server error"
//	@Security		OAuth2Password[me]
//	@Router			/user/logout [post]
func (h *Handler) Logout(c echo.Context) error {
	ctx := context.Background()

	// Get userID from jwt token
	claim, err := auth.GetJWTClaims(&c)
	if err != nil {
		return err
	}

	// Update logout time in login history
	err = h.userStore.UpdateLogoutTime(ctx, claim.UserID, claim.IssuedAt.Time, time.Now())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, response.NewError("failed to update logout time: "+err.Error()))
	}

	return c.JSON(http.StatusOK, response.NewSuccess("logout successful"))
}
