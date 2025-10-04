package userrole

type Role int64

const (
	Admin Role = iota + 1
	Manager
	Student
)

type RoleName string

const (
	RoleNameAdmin   RoleName = "admin"
	RoleNameManager RoleName = "manager"
	RoleNameStudent RoleName = "student"
)

func RoleIDToUserRole() map[Role]RoleName {
	return map[Role]RoleName{
		Admin:   RoleNameAdmin,
		Manager: RoleNameManager,
		Student: RoleNameStudent,
	}
}

func RoleNameToUserRole() map[RoleName]Role {
	return map[RoleName]Role{
		RoleNameAdmin:   Admin,
		RoleNameManager: Manager,
		RoleNameStudent: Student,
	}
}
