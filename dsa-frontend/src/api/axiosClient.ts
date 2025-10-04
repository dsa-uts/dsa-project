import axios, { AxiosError, type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { TOKEN_EXPIRY_KEY, TOKEN_KEY } from "../auth/hooks";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;


interface ErrorResponse {
  errors?: {
    body?: string;
    [key: string]: any;
  }
}

export interface SuccessResponse {
  message?: string;
}

export const axiosClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
});

// Settings of middleware for client requests.
axiosClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // At now, it does not add Authorization header automatically
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
)

// Settings of middleware for client response.
axiosClient.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  (error: AxiosError<ErrorResponse>) => {
    if (error.response?.status === 401) {
      // save current path
      const currentPath = window.location.pathname;

      // Clear stored token and expiry time
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_EXPIRY_KEY);

      window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`; // Redirect to login page
      return Promise.reject(new Error('Unauthorized'))
    }

    const message = error.response?.data?.errors?.body || 'Request failed';

    return Promise.reject(new Error(message));
  }
);

