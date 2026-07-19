package handler

import (
	"fmt"
	"net/http"

	echo "github.com/labstack/echo/v4"
)

type helloRequest struct {
	Name string `json:"name" validate:"required"`
}

type helloResponse struct {
	Message string `json:"message"`
}

func HelloGet(c echo.Context) error {
	return c.JSON(http.StatusOK, helloResponse{Message: "hello"})
}

func HelloPost(c echo.Context) error {
	var req helloRequest
	if err := c.Bind(&req); err != nil {
		return err
	}
	if err := c.Validate(&req); err != nil {
		return err
	}
	return c.JSON(http.StatusOK, helloResponse{Message: fmt.Sprintf("hello, %s", req.Name)})
}
