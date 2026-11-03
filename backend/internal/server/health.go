package server

import "net/http"

// Health is the liveness/readiness endpoint for Kubernetes probes.
func Health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte("{\"status\":\"ok\"}\n"))
}
