import type React from "react";
import { Navigate, useLocation } from "react-router";
import { clearStoredToken, useAuth } from "./auth/hooks";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated()) {
    clearStoredToken();
    // Save the current location in state so that we can redirect after login
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>
}

export default ProtectedRoute;