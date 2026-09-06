package auth

// AllowsRole reports whether a Role meets the minimum required Role.
// Admin inherits Manager and Student permissions; unknown Roles are denied.
func AllowsRole(actual, required string) bool {
	actualRank, requiredRank := roleRank(actual), roleRank(required)
	return actualRank > 0 && requiredRank > 0 && actualRank >= requiredRank
}

func roleRank(role string) int {
	switch role {
	case "student":
		return 1
	case "manager":
		return 2
	case "admin":
		return 3
	default:
		return 0
	}
}
