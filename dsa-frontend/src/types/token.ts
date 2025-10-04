export enum UserRole {
    admin = "admin",
    manager = "manager",
    student = "student"
}

export type Token = {
    access_token: string;
    token_type: string;
    login_time: string;
    user_id: string;
    role: UserRole;
    refresh_count: number;
};

export type TokenResponse = {
    is_valid: boolean;
}
