package httpauth_test

import (
	"testing"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/getkin/kin-openapi/openapi3"
)

func TestAccessPoliciesRejectUndeclaredNewOperation(t *testing.T) {
	spec, err := generated.GetSpec()
	if err != nil {
		t.Fatal(err)
	}
	spec.Paths.Set("/api/new", &openapi3.PathItem{Get: &openapi3.Operation{OperationID: "newOperation"}})
	if err := httpauth.ValidateAccessPolicies(spec); err == nil {
		t.Fatal("undeclared operation must prevent registration")
	}
}

func TestEmbeddedAccessPolicies(t *testing.T) {
	spec, err := generated.GetSpec()
	if err != nil {
		t.Fatal(err)
	}
	if err := httpauth.ValidateAccessPolicies(spec); err != nil {
		t.Fatal(err)
	}
	for _, want := range []struct{ path, method, policy string }{
		{"/api/session", "POST", "public"},
		{"/api/session", "DELETE", "public"},
		{"/api/me", "GET", "authenticated"},
		{"/api/admin/users", "GET", "admin"},
		{"/api/admin/users", "POST", "admin"},
		{"/api/admin/users/{user_id}", "PATCH", "admin"},
	} {
		if got := spec.Paths.Value(want.path).GetOperation(want.method).Extensions["x-access-policy"]; got != want.policy {
			t.Errorf("%s %s: policy = %v, want %s", want.method, want.path, got, want.policy)
		}
	}
}

func TestAccessPolicyDeclarations(t *testing.T) {
	for _, tt := range []struct {
		name     string
		policy   any
		security *openapi3.SecurityRequirements
		valid    bool
	}{
		{"public", "public", new(openapi3.SecurityRequirements{}), true},
		{"authenticated", "authenticated", new(openapi3.SecurityRequirements{{"sessionAuth": {}}}), true},
		{"admin", "admin", new(openapi3.SecurityRequirements{{"sessionAuth": {}}}), true},
		{"missing policy", nil, new(openapi3.SecurityRequirements{}), false},
		{"numeric policy", 1, new(openapi3.SecurityRequirements{}), false},
		{"object policy", map[string]any{}, new(openapi3.SecurityRequirements{}), false},
		{"unknown policy", "manager", new(openapi3.SecurityRequirements{{"sessionAuth": {}}}), false},
		{"public inherited security", "public", nil, false},
		{"public authenticated security", "public", new(openapi3.SecurityRequirements{{"sessionAuth": {}}}), false},
		{"public anonymous alternative", "public", new(openapi3.SecurityRequirements{{}}), false},
		{"authenticated inherited security", "authenticated", nil, false},
		{"admin public security", "admin", new(openapi3.SecurityRequirements{}), false},
		{"anonymous requirement", "admin", new(openapi3.SecurityRequirements{{}}), false},
		{"anonymous alternative", "admin", new(openapi3.SecurityRequirements{{"sessionAuth": {}}, {}}), false},
		{"unsupported scheme", "admin", new(openapi3.SecurityRequirements{{"otherAuth": {}}}), false},
		{"additional scheme", "admin", new(openapi3.SecurityRequirements{{"sessionAuth": {}, "otherAuth": {}}}), false},
		{"role scope", "admin", new(openapi3.SecurityRequirements{{"sessionAuth": {"admin"}}}), false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			spec, err := generated.GetSpec()
			if err != nil {
				t.Fatal(err)
			}
			// A global requirement must not rescue a missing operation declaration.
			spec.Security = openapi3.SecurityRequirements{{"sessionAuth": {}}}
			operation := spec.Paths.Value("/api/me").Get
			operation.Extensions = map[string]any{"x-access-policy": tt.policy}
			operation.Security = tt.security
			if err := httpauth.ValidateAccessPolicies(spec); (err == nil) != tt.valid {
				t.Fatalf("valid = %t, error = %v", tt.valid, err)
			}
		})
	}
}

func TestSessionAuthSchemeMustMatchSessionCookie(t *testing.T) {
	for _, tt := range []struct {
		name   string
		scheme *openapi3.SecuritySchemeRef
	}{
		{"missing", nil},
		{"unresolved", &openapi3.SecuritySchemeRef{Ref: "missing"}},
		{"bearer", &openapi3.SecuritySchemeRef{Value: &openapi3.SecurityScheme{Type: "http", Scheme: "bearer"}}},
		{"header", &openapi3.SecuritySchemeRef{Value: &openapi3.SecurityScheme{Type: "apiKey", In: "header", Name: "__Host-dsa_session"}}},
		{"wrong cookie", &openapi3.SecuritySchemeRef{Value: &openapi3.SecurityScheme{Type: "apiKey", In: "cookie", Name: "other"}}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			spec, err := generated.GetSpec()
			if err != nil {
				t.Fatal(err)
			}
			spec.Components.SecuritySchemes["sessionAuth"] = tt.scheme
			if err := httpauth.ValidateAccessPolicies(spec); err == nil {
				t.Fatal("unsupported scheme accepted")
			}
		})
	}
}
