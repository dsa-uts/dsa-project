package auth

type Role string

const (
	RoleStudent Role = "student"
	RoleManager Role = "manager"
	RoleAdmin   Role = "admin"
)

// AllowsRole reports whether a Role meets the minimum required Role.
// Admin inherits Manager and Student permissions; unknown Roles are denied.
func AllowsRole(actual, required Role) bool {
	actualRank, requiredRank := roleRank(actual), roleRank(required)
	return actualRank > 0 && requiredRank > 0 && actualRank >= requiredRank
}

func roleRank(role Role) int {
	switch role {
	case RoleStudent:
		return 1
	case RoleManager:
		return 2
	case RoleAdmin:
		return 3
	default:
		return 0
	}
}
