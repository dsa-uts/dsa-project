import { useMutation, useQuery, useQueryClient, type UseMutationOptions, type UseQueryOptions } from "@tanstack/react-query";
import { useCallback } from "react";
import { type AxiosRequestConfig } from "axios";
import { axiosClient } from "../api/axiosClient";

export interface User {
  id: string;
  name: string;
  email?: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

interface LoginResponse {
  access_token: string;
  token_type: string;
  exp: number;
  user: User;
};

export const TOKEN_KEY = 'authToken';
export const TOKEN_EXPIRY_KEY = 'tokenExpiry';

interface JWTPayload {
  id: number;
  userid: string;
  scopes: ('grading' | 'admin')[];
  exp: number;
  iat: number;
}

const base64UrlDecode = (str: string): string => {
  // Convert from base64url to base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding if necessary
  const pad = base64.length % 4;
  if (pad) {
    if (pad === 1) {
      throw new Error('Invalid base64url string');
    }
    base64 += '='.repeat(4 - pad);
  }

  // Decode base64 string
  try {
    return decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch (e) {
    throw new Error('Failed to decode base64url string');
  }
};

const parseJWTPayload = (token: string): JWTPayload => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT token');
    }

    const payload = base64UrlDecode(parts[1]);
    return JSON.parse(payload) as JWTPayload;
  } catch (e) {
    throw new Error('Failed to parse JWT token');
  }
};

const hasScope = (scope: 'grading' | 'admin'): boolean => {
  const { token } = getStoredToken();
  if (!token) {
    return false;
  }

  try {
    const payload = parseJWTPayload(token);
    // console.log('Token: ', payload);
    return payload.scopes.includes(scope);
  } catch (e) {
    console.error('Error parsing JWT token:', e);
    return false;
  }
}

export const hasAdminScope = (): boolean => {
  return hasScope('admin');
}

export const hasGradingScope = (): boolean => {
  return hasScope('grading');
}

export const getStoredToken = (): { token: string | null; expiry: number | null } => {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
  return {
    token,
    expiry: expiry ? parseInt(expiry, 10) : null,
  };
};

export const saveToken = (token: string, exp: number): void => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TOKEN_EXPIRY_KEY, exp.toString());
};

export const clearStoredToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
};

const currentTimeInSecondsFromEpoch = (): number => {
  return Math.floor(Date.now() / 1000);
};

export const isTokenValid = (): boolean => {
  const { token, expiry } = getStoredToken();
  const elapsedSecondsFromEpoch = currentTimeInSecondsFromEpoch();
  return !!token && !!expiry && expiry > elapsedSecondsFromEpoch + 10;
}

export const useToken = () => {
  const setToken = useCallback((newToken: string | null, exp?: number) => {
    if (newToken && exp) {
      saveToken(newToken, exp);
    } else {
      clearStoredToken();
    }
  }, []);

  return {
    getStoredToken,
    setToken,
    isValid: isTokenValid,
  };
};

export const addAuthorizationHeader = (config: AxiosRequestConfig | undefined): AxiosRequestConfig => {
  const { token, expiry } = getStoredToken();

  if (!token) {
    throw new Error('No token found');
  }

  if (!expiry || expiry < currentTimeInSecondsFromEpoch()) {
    clearStoredToken();
    throw new Error('Token expired');
  }

  return {
    ...config,
    headers: {
      ...config?.headers,
      Authorization: `Bearer ${token}`,
    },
  };
};

interface AuthQueryArgs {
  queryKey: string[];
  endpoint: string;
  options?: {
    queryOptions?: Omit<UseQueryOptions<any, Error>, 'queryKey' | 'queryFn'>;
    axiosConfig?: AxiosRequestConfig;
  };
}

/**
 * GET request hook with authorization
 * @param queryKey 
 * @param endpoint 
 * @param options 
 * @returns 
 */
export const useAuthQuery = <TData = any>(args: AuthQueryArgs) => {
  const { queryKey, endpoint, options } = args;

  return useQuery<TData, Error>({
    queryKey,
    queryFn: async () => {
      const newAxiosConfig = addAuthorizationHeader(options?.axiosConfig);
      const response = await axiosClient.get<TData>(endpoint, newAxiosConfig);
      return response.data;
    },
    ...options?.queryOptions,
  });
};

interface AuthMutationArgs<TVariables> {
  endpoint: string | ((variables: TVariables) => string);
  options?: {
    method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    mutationOptions?: Omit<UseMutationOptions<any, Error, TVariables>, 'mutationFn'>;
    axiosConfig?: AxiosRequestConfig;
  };
}

/**
 * POST | PUT | PATCH | DELETE request hook with authorization
 * @param endpoint 
 * @param options 
 * @returns 
 */
export const useAuthMutation = <TData = any, TVariables = any>(
  args: AuthMutationArgs<TVariables>
) => {
  const { endpoint, options } = args;
  const method = options?.method || 'POST';

  return useMutation<TData, Error, TVariables>({
    mutationFn: async (variables) => {
      const url = typeof endpoint === 'function' ? endpoint(variables) : endpoint;
      const newAxiosConfig = addAuthorizationHeader(options?.axiosConfig);

      let response;
      switch (method) {
        case 'DELETE':
          response = await axiosClient.delete<TData>(url, newAxiosConfig);
          break;
        case 'PUT':
          response = await axiosClient.put<TData>(url, variables, newAxiosConfig);
          break;
        case 'PATCH':
          response = await axiosClient.patch<TData>(url, variables, newAxiosConfig);
          break;
        default:
          response = await axiosClient.post<TData>(url, variables, newAxiosConfig);
      }

      return response.data;
    },
    ...options?.mutationOptions,
  });
};

/**
 * More flexible fetch hook with authorization
 */
export const useAuthFetch = () => {
  const authFetch = useCallback(async <T = any>(
    config: AxiosRequestConfig
  ): Promise<T> => {
    const newConfig = addAuthorizationHeader(config);
    const response = await axiosClient.request<T>(newConfig);
    return response.data;
  }, []);

  return { authFetch, axiosClient };
};

export const useLoginMutation = () => {
  const queryClient = useQueryClient();

  return useMutation<LoginResponse, Error, LoginCredentials>({
    mutationFn: async (credentials) => {
      const response = await axiosClient.post<LoginResponse>(
        `/user/login`,
        credentials,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      return response.data;
    },
    onSuccess: (data) => {
      saveToken(data.access_token, data.exp);
      if (data.user) {
        // save current user information to cache
        queryClient.setQueryData(['currentUser'], data.user);
      }
      // Invalidate all queries to refetch data
      queryClient.invalidateQueries();
    }
  });
};

export const useLogout = () => {
  const queryClient = useQueryClient();

  const logoutMutation = useAuthMutation<void, void>({
    endpoint: '/user/logout',
    options: {
      method: 'POST',
      mutationOptions: {
        onSettled: () => {
          // clear auth information whatever api fails
          clearStoredToken();
          queryClient.clear();
        },
      }
    }
  });

  return {
    logout: () => logoutMutation.mutateAsync(),
    isLoading: logoutMutation.isPending,
  };
};

export const useCurrentUser = () => {
  const isValid = isTokenValid();

  return useAuthQuery<User>({
    queryKey: ['currentUser'],
    endpoint: '/user/me',
    options: {
      queryOptions: {
        enabled: isValid,
        staleTime: 5 * 60 * 1000, // 5 minutes
        retry: false, // when error encounters, we don't retry
      },
    }
  });
};

export const useAuth = () => {
  const loginMutation = useLoginMutation();
  const { logout, isLoading: isLogoutLoading } = useLogout();


  return {
    isAuthenticated: isTokenValid,
    login: loginMutation.mutate,
    loginResponse: loginMutation.data,
    isLoginPending: loginMutation.isPending,
    loginError: loginMutation.error,
    logout,
    isLogoutLoading,
    hasAdminScope,
    hasGradingScope,
  }
}
