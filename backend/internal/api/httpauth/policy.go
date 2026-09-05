package httpauth

import (
	"fmt"

	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/getkin/kin-openapi/openapi3"
)

const accessPolicyExtension = "x-access-policy"

// ValidateAccessPolicies checks every operation before any API route is registered.
// Only explicit public access or a single cookie requirement is supported; neither
// inherited security nor alternative requirements may silently grant access.
func ValidateAccessPolicies(spec *openapi3.T) error {
	for path, item := range spec.Paths.Map() {
		for method, operation := range item.Operations() {
			if err := validateAccessPolicy(operation); err != nil {
				return fmt.Errorf("%s %s (%s): %w", method, path, operation.OperationID, err)
			}
		}
	}
	if spec.Components == nil {
		return fmt.Errorf("sessionAuth security scheme is required")
	}
	ref := spec.Components.SecuritySchemes["sessionAuth"]
	if ref == nil || ref.Value == nil || ref.Value.Type != "apiKey" || ref.Value.In != "cookie" || ref.Value.Name != auth.SessionCookieName {
		return fmt.Errorf("sessionAuth must be an apiKey cookie named %s", auth.SessionCookieName)
	}
	return nil
}

func validateAccessPolicy(operation *openapi3.Operation) error {
	policy, ok := operation.Extensions[accessPolicyExtension].(string)
	if !ok {
		return fmt.Errorf("%s must be a string", accessPolicyExtension)
	}
	switch policy {
	case "public":
		if operation.Security == nil || len(*operation.Security) != 0 {
			return fmt.Errorf("public requires explicit security: []")
		}
	case "authenticated", "admin":
		if operation.Security == nil || len(*operation.Security) != 1 {
			return fmt.Errorf("%s requires exactly one sessionAuth requirement", policy)
		}
		requirement := (*operation.Security)[0]
		scopes, ok := requirement["sessionAuth"]
		if !ok || len(requirement) != 1 || len(scopes) != 0 {
			return fmt.Errorf("%s requires only sessionAuth with no scopes", policy)
		}
	default:
		return fmt.Errorf("unknown %s %q", accessPolicyExtension, policy)
	}
	return nil
}
