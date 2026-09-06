package auth_test

import (
	"testing"

	"github.com/dsa-uts/dsa-project/backend/internal/auth"
)

func TestAllowsRole(t *testing.T) {
	for _, tt := range []struct {
		actual, required string
		want             bool
	}{
		{"student", "student", true},
		{"student", "manager", false},
		{"student", "admin", false},
		{"manager", "student", true},
		{"manager", "manager", true},
		{"manager", "admin", false},
		{"admin", "student", true},
		{"admin", "manager", true},
		{"admin", "admin", true},
		{"unknown", "student", false},
		{"admin", "unknown", false},
		{"unknown", "unknown", false},
		{"", "student", false},
		{"admin", "", false},
		{"", "", false},
	} {
		t.Run(tt.actual+"/"+tt.required, func(t *testing.T) {
			if got := auth.AllowsRole(tt.actual, tt.required); got != tt.want {
				t.Fatalf("AllowsRole(%q, %q) = %t, want %t", tt.actual, tt.required, got, tt.want)
			}
		})
	}
}
