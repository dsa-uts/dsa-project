package httpauth_test

import (
	"reflect"
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
	if spec.OpenAPI != "3.1.0" {
		t.Fatalf("OpenAPI version = %s, want 3.1.0", spec.OpenAPI)
	}
	if err := spec.Validate(t.Context()); err != nil {
		t.Fatal(err)
	}
	for _, want := range []struct {
		path, method string
		security     openapi3.SecurityRequirements
	}{
		{"/api/session", "POST", openapi3.SecurityRequirements{}},
		{"/api/session", "DELETE", openapi3.SecurityRequirements{}},
		{"/api/me", "GET", openapi3.SecurityRequirements{{"sessionAuth": {}}}},
		{"/api/admin/users", "GET", openapi3.SecurityRequirements{{"sessionAuth": {"admin"}}}},
		{"/api/admin/users", "POST", openapi3.SecurityRequirements{{"sessionAuth": {"admin"}}}},
		{"/api/admin/users/{user_id}", "PATCH", openapi3.SecurityRequirements{{"sessionAuth": {"admin"}}}},
	} {
		got := spec.Paths.Value(want.path).GetOperation(want.method).Security
		if got == nil || !reflect.DeepEqual(*got, want.security) {
			t.Errorf("%s %s: security = %v, want %v", want.method, want.path, got, want.security)
		}
	}
}

func TestAccessPolicyDeclarations(t *testing.T) {
	for _, tt := range []struct {
		name     string
		security *openapi3.SecurityRequirements
		valid    bool
	}{
		{"public", new(openapi3.SecurityRequirements{}), true},
		{"authenticated", new(openapi3.SecurityRequirements{{"sessionAuth": {}}}), true},
		{"admin", new(openapi3.SecurityRequirements{{"sessionAuth": {"admin"}}}), true},
		{"student", new(openapi3.SecurityRequirements{{"sessionAuth": {"student"}}}), true},
		{"manager or admin", new(openapi3.SecurityRequirements{{"sessionAuth": {"manager"}}, {"sessionAuth": {"admin"}}}), true},
		{"all roles required", new(openapi3.SecurityRequirements{{"sessionAuth": {"manager", "admin"}}}), true},
		{"inherited security", nil, false},
		{"anonymous requirement", new(openapi3.SecurityRequirements{{}}), false},
		{"anonymous alternative", new(openapi3.SecurityRequirements{{"sessionAuth": {}}, {}}), false},
		{"unsupported scheme", new(openapi3.SecurityRequirements{{"otherAuth": {}}}), false},
		{"additional scheme", new(openapi3.SecurityRequirements{{"sessionAuth": {}, "otherAuth": {}}}), false},
		{"unknown role", new(openapi3.SecurityRequirements{{"sessionAuth": {"user"}}}), false},
		{"unknown role alternative", new(openapi3.SecurityRequirements{{"sessionAuth": {"admin"}}, {"sessionAuth": {"unknown"}}}), false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			spec, err := generated.GetSpec()
			if err != nil {
				t.Fatal(err)
			}
			// A global requirement must not rescue a missing operation declaration.
			spec.Security = openapi3.SecurityRequirements{{"sessionAuth": {}}}
			operation := spec.Paths.Value("/api/admin/users").Get
			operation.Extensions = nil
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

func TestAccessPoliciesRequireErrorResponses(t *testing.T) {
	for _, tt := range []struct{ path, method, status string }{
		{"/api/me", "GET", "401"},
		{"/api/me", "GET", "500"},
		{"/api/admin/users", "GET", "401"},
		{"/api/admin/users", "GET", "403"},
		{"/api/admin/users", "GET", "500"},
	} {
		t.Run(tt.path+tt.status, func(t *testing.T) {
			spec, err := generated.GetSpec()
			if err != nil {
				t.Fatal(err)
			}
			spec.Paths.Value(tt.path).GetOperation(tt.method).Responses.Delete(tt.status)
			if err := httpauth.ValidateAccessPolicies(spec); err == nil {
				t.Fatalf("missing %s response must prevent registration", tt.status)
			}
		})
	}
}
