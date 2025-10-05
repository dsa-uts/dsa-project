package router

import (
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

	// CORS setting
	// localhost:80 is for development with gateway server (nginx)
	// localhost:5173 is for development with frontend server (vite)
	// dsa.kde.cs.tsukuba.ac.jp is for production
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{"http://localhost:80", "http://localhost:5173", "https://dsa.kde.cs.tsukuba.ac.jp"},
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization},
		AllowMethods: []string{echo.GET, echo.HEAD, echo.PUT, echo.POST, echo.DELETE, echo.PATCH, echo.OPTIONS},
	}))

	// Set custom validator for URL path parameter, query parameter, header and request body.
	e.Validator = NewValidator()

	return e
}
