package auth

import (
	"fmt"

	"github.com/dsa-uts/dsa-project/database/model/userrole"
)

type Scope string

const (
	ScopeGrading = Scope("grading")
	ScopeAdmin   = Scope("admin")
)

func UserScopes() map[userrole.Role][]Scope {
	return map[userrole.Role][]Scope{
		userrole.Admin:   {ScopeGrading, ScopeAdmin},
		userrole.Manager: {ScopeGrading},
		userrole.Student: {},
	}
}

func GetUserScopes(userRole userrole.Role) ([]Scope, error) {
	scopes, ok := UserScopes()[userRole]
	if !ok {
		return nil, fmt.Errorf("invalid user role: %d", userRole)
	}
	return scopes, nil
}

func GetRoleName(roleID userrole.Role) (userrole.RoleName, error) {
	roleName, ok := userrole.RoleIDToUserRole()[roleID]
	if !ok {
		return "", fmt.Errorf("invalid role ID: %d", roleID)
	}
	return roleName, nil
}
