import { UserRole } from "./token";

export type User = {
    user_id: string;
    username: string;
    email: string;
    role: UserRole;
    disabled: boolean;
    created_at: Date;
    updated_at: Date;
    active_start_date: Date;
    active_end_date: Date;
}

export type LoginCredentials = {
    user_id: string;
    password: string;
}

export type CreateUser = {
    user_id: string;
    username: string;
    email: string;
    plain_password: string;
    role: UserRole;
    disabled: boolean;
    active_start_date?: Date | null;
    active_end_date?: Date | null;
}

export type UserDelete = {
    user_ids: string[];
}

export type UserUpdatePassword = {
    user_id: string;
    plain_password: string;
    new_plain_password: string;
}
