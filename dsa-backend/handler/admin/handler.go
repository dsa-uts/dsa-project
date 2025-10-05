package admin

import (
	"dsa-backend/handler/auth"
	"dsa-backend/handler/middleware"

	"github.com/dsa-uts/dsa-project/database"
	"github.com/labstack/echo/v4"
	"github.com/uptrace/bun"
)

type Handler struct {
	db        *bun.DB
	userStore database.UserStore
	jwtSecret string
}

func NewAdminHandler(jwtSecret string, db *bun.DB) *Handler {
	return &Handler{
		db:        db,
		userStore: *database.NewUserStore(db),
		jwtSecret: jwtSecret,
	}
}

func (h *Handler) RegisterRoutes(r *echo.Group) {
	r.Use(middleware.JWTMiddleware(h.jwtSecret),
		middleware.CheckValidityOfJWTMiddleware(h.db),
		middleware.RequiredScopesMiddleware(auth.ScopeAdmin))

	r.POST("/register", h.RegisterUser)
	r.PATCH("/archive/:user_id", h.ArchiveUser)
	r.PATCH("/activate/:user_id", h.ActivateUser)
	r.PATCH("/modify/:user_id", h.ModifyUser)
	r.DELETE("/delete/:user_id", h.DeleteUser)
	r.GET("/users", h.ListUsers)
}
