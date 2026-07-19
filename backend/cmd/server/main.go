package main

import (
	"log"
	"net"
	"os"

	"github.com/dsa-uts/dsa-project/backend/internal/server"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	e := server.New()
	log.Fatal(e.Start(net.JoinHostPort("", port)))
}
