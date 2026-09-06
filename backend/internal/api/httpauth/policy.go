package httpauth

import (
	"fmt"

	"github.com/dsa-uts/dsa-project/backend/internal/auth"
	"github.com/getkin/kin-openapi/openapi3"
)

// ValidateAccessPolicies checks every operation before any API route is registered.
// Each operation declares public access or sessionAuth requirements explicitly.
// A sessionAuth requirement declares at most one minimum Role.
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
	if operation.Security == nil {
		return fmt.Errorf("explicit security is required")
	}
	if len(*operation.Security) > 1 {
		return fmt.Errorf("at most one security requirement is supported")
	}
	for _, requirement := range *operation.Security {
		roles, ok := requirement["sessionAuth"]
		if !ok || len(requirement) != 1 {
			return fmt.Errorf("each security requirement must contain only sessionAuth")
		}
		if len(roles) > 1 {
			return fmt.Errorf("sessionAuth accepts at most one minimum Role")
		}
		for _, role := range roles {
			if !auth.AllowsRole(role, role) {
				return fmt.Errorf("unknown sessionAuth Role %q", role)
			}
		}
	}
	return nil
}
