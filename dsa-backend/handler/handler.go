package handler

import (
	"crypto/rand"
	"dsa-backend/handler/problem"
	"dsa-backend/handler/user"
	"encoding/hex"
	"fmt"

	"github.com/labstack/echo/v4"
	"github.com/uptrace/bun"
)

type Handler struct {
	db        *bun.DB
	jwtSecret string
}

func NewHandler(db *bun.DB) *Handler {
	return &Handler{
		db:        db,
		jwtSecret: generateSecretKey(),
	}
}

func (h *Handler) RegisterRoutes(r *echo.Group) {
	userHandler := user.NewUserHandler(h.jwtSecret, h.db)
	userRouter := r.Group("/user")
	userHandler.RegisterRoutes(userRouter)

	problemHandler := problem.NewProblemHandler(h.jwtSecret, h.db)
	problemRouter := r.Group("/problem")
	problemHandler.RegisterRoutes(problemRouter)
}

func generateSecretKey() string {
	// generate random 32-byte key
	key := make([]byte, 32)
	_, err := rand.Read(key)
	if err != nil {
		panic(fmt.Sprintf("failed to generate secret key: %v", err))
	}
	// convert to hex
	return hex.EncodeToString(key)
}
