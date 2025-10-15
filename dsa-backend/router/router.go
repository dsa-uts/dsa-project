package router

import (
	"dsa-backend/config"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/labstack/gommon/log"
)

func New() *echo.Echo {
	e := echo.New()
	e.Logger.SetLevel(log.DEBUG)
	e.Pre(middleware.RemoveTrailingSlash())
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())

	if config.Cfg == nil {
		panic("config.Cfg is nil, please load config before initializing router")
	}

	// CORS settings
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: config.Cfg.CORSAllowedOrigins,
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization},
		AllowMethods: []string{echo.GET, echo.HEAD, echo.PUT, echo.POST, echo.DELETE, echo.PATCH, echo.OPTIONS},
	}))

	// Set custom validator for URL path parameter, query parameter, header and request body.
	e.Validator = NewValidator()

	return e
}
