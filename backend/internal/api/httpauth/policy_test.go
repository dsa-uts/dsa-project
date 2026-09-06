package httpauth_test

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/dsa-uts/dsa-project/backend/internal/api/generated"
	"github.com/dsa-uts/dsa-project/backend/internal/api/httpauth"
	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/getkin/kin-openapi/openapi3"
)

func TestAccessPoliciesRejectUndeclaredNewOperation(t *testing.T) {
	spec := minimalSpec()
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
	for path, item := range spec.Paths.Map() {
		for method, operation := range item.Operations() {
			if err := validateContractPolicy(path, operation); err != nil {
				t.Errorf("%s %s: %v", method, path, err)
			}
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
		{"manager", new(openapi3.SecurityRequirements{{"sessionAuth": {"manager"}}}), true},
		{"manager or admin", new(openapi3.SecurityRequirements{{"sessionAuth": {"manager"}}, {"sessionAuth": {"admin"}}}), false},
		{"all roles required", new(openapi3.SecurityRequirements{{"sessionAuth": {"manager", "admin"}}}), false},
		{"inherited security", nil, false},
		{"anonymous requirement", new(openapi3.SecurityRequirements{{}}), false},
		{"anonymous alternative", new(openapi3.SecurityRequirements{{"sessionAuth": {}}, {}}), false},
		{"unsupported scheme", new(openapi3.SecurityRequirements{{"otherAuth": {}}}), false},
		{"additional scheme", new(openapi3.SecurityRequirements{{"sessionAuth": {}, "otherAuth": {}}}), false},
		{"unknown role", new(openapi3.SecurityRequirements{{"sessionAuth": {"user"}}}), false},
		{"unknown role alternative", new(openapi3.SecurityRequirements{{"sessionAuth": {"admin"}}, {"sessionAuth": {"unknown"}}}), false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			spec := minimalSpec()
			// A global requirement must not rescue a missing operation declaration.
			spec.Security = openapi3.SecurityRequirements{{"sessionAuth": {}}}
			operation := spec.Paths.Value("/example").Get
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
			spec := minimalSpec()
			spec.Components.SecuritySchemes["sessionAuth"] = tt.scheme
			if err := httpauth.ValidateAccessPolicies(spec); err == nil {
				t.Fatal("unsupported scheme accepted")
			}
		})
	}
}

// minimalSpec deliberately has no responses: startup validates access declarations only.
func minimalSpec() *openapi3.T {
	return &openapi3.T{
		Paths: openapi3.NewPaths(openapi3.WithPath("/example", &openapi3.PathItem{
			Get: &openapi3.Operation{Security: new(openapi3.SecurityRequirements{})},
		})),
		Components: &openapi3.Components{SecuritySchemes: openapi3.SecuritySchemes{
			"sessionAuth": &openapi3.SecuritySchemeRef{Value: &openapi3.SecurityScheme{
				Type: "apiKey", In: "cookie", Name: auth.SessionCookieName,
			}},
		}},
	}
}

func validateContractPolicy(path string, operation *openapi3.Operation) error {
	if operation.Security == nil {
		return fmt.Errorf("explicit security is required")
	}
	security := *operation.Security
	if path == "/api/admin" || strings.HasPrefix(path, "/api/admin/") {
		if len(security) != 1 || len(security[0]) != 1 || !slices.Equal(security[0]["sessionAuth"], []string{"admin"}) {
			return fmt.Errorf("admin operations must require Admin")
		}
	}
	if len(security) == 0 {
		return nil
	}
	statuses := []string{"401", "500"}
	if len(security[0]["sessionAuth"]) > 0 {
		statuses = append(statuses, "403")
	}
	for _, status := range statuses {
		if operation.Responses == nil || operation.Responses.Value(status) == nil || operation.Responses.Value(status).Value == nil {
			return fmt.Errorf("security requires a %s response", status)
		}
	}
	return nil
}

func TestAdminContractPolicy(t *testing.T) {
	for _, path := range []string{"/api/admin", "/api/admin/", "/api/admin/new/{id}", "/api/administrator", "/api/admin-tools", "/example"} {
		for _, role := range []string{"public", "", "student", "manager", "admin"} {
			t.Run(path+"/"+role, func(t *testing.T) {
				security := openapi3.SecurityRequirements{}
				if role != "public" {
					roles := []string{}
					if role != "" {
						roles = append(roles, role)
					}
					security = openapi3.SecurityRequirements{{"sessionAuth": roles}}
				}
				operation := &openapi3.Operation{Security: &security, Responses: authResponses()}
				adminPath := path == "/api/admin" || path == "/api/admin/" || path == "/api/admin/new/{id}"
				wantValid := !adminPath || role == "admin"
				if err := validateContractPolicy(path, operation); (err == nil) != wantValid {
					t.Fatalf("valid = %t, error = %v", wantValid, err)
				}
			})
		}
	}
}

func TestContractErrorResponses(t *testing.T) {
	for _, tt := range []struct {
		name     string
		security openapi3.SecurityRequirements
		required []string
	}{
		{"public", openapi3.SecurityRequirements{}, nil},
		{"authenticated", openapi3.SecurityRequirements{{"sessionAuth": {}}}, []string{"401", "500"}},
		{"student", openapi3.SecurityRequirements{{"sessionAuth": {"student"}}}, []string{"401", "403", "500"}},
		{"manager", openapi3.SecurityRequirements{{"sessionAuth": {"manager"}}}, []string{"401", "403", "500"}},
		{"admin", openapi3.SecurityRequirements{{"sessionAuth": {"admin"}}}, []string{"401", "403", "500"}},
	} {
		for _, missing := range []string{"", "401", "403", "500", "all"} {
			t.Run(tt.name+"/"+missing, func(t *testing.T) {
				responses := authResponses()
				responses.Delete(missing)
				if missing == "all" {
					responses = nil
				}
				operation := &openapi3.Operation{Security: &tt.security, Responses: responses}
				wantValid := !slices.Contains(tt.required, missing) && (missing != "all" || len(tt.required) == 0)
				if err := validateContractPolicy("/example", operation); (err == nil) != wantValid {
					t.Fatalf("valid = %t, error = %v", wantValid, err)
				}
			})
		}
	}
}

func authResponses() *openapi3.Responses {
	responses := openapi3.NewResponses()
	for _, status := range []string{"401", "403", "500"} {
		responses.Set(status, &openapi3.ResponseRef{Value: &openapi3.Response{Description: new("error")}})
	}
	return responses
}
