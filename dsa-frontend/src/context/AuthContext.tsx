// src/context/AuthContext.tsx
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { logout as logoutApi } from '../api/PostAPI';
import { useLocation } from 'react-router-dom';
import { UserRole } from '../types/token';

interface AuthContextType {
    token: string | null;
    user_id: string | null;
    role: UserRole | null;
    setToken: (token: string | null) => void;
    setUserId: (user_id: string | null) => void;
    setRole: (role: UserRole) => void;
    logout: () => void;
}

// 呼び出したコンポーネントより上位のコンポーネントでAuthProviderを使用してない場合、undefinedが返される
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// AuthContextTypeを返す関数。
// 呼び出したコンポーネントより上位のコンポーネントでAuthProviderを使用してない場合、例外がスローされる
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
    const [user_id, setUserId] = useState<string | null>(localStorage.getItem('user_id'));
    const [role, setRole] = useState<UserRole | null>(localStorage.getItem('role') as UserRole);
    const location = useLocation();

    const saveToken = (newToken: string | null) => {
        setToken(newToken);
        if (newToken === null) {
            localStorage.removeItem('token');
        } else {
            localStorage.setItem('token', newToken);
        }
    };

    const saveUserId = (newUserId: string | null) => {
        setUserId(newUserId);
        if (newUserId === null) {
            localStorage.removeItem('user_id');
        } else {
            localStorage.setItem('user_id', newUserId);
        }
    };

    const saveRole = (newRole: UserRole | null) => {
        setRole(newRole);
        if (newRole === null) {
            localStorage.removeItem('role');
        } else {
            localStorage.setItem('role', newRole);
        }
    };

    const logout = () => {
        logoutApi(token as string);
        saveToken(null);
        saveUserId(null);
        saveRole(null);
        // window.location.href = '/login';
        const redirectUrl = location.pathname + location.search;
        sessionStorage.setItem('redirectUrl', redirectUrl);
    };

    return (
        <AuthContext.Provider value={{ token, user_id, role, setToken: saveToken, setUserId: saveUserId, setRole: saveRole, logout }}>
            {children}
        </AuthContext.Provider>
    );
};
