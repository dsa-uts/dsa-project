import type React from "react";
import { clearStoredToken, useAuth } from "./auth/hooks";
import { Navigate, useLocation } from "react-router";

interface AdminRouteProps {
  children: React.ReactNode;
}

const AdminRoute: React.FC<AdminRouteProps> = ({ children }) => {
  const { hasAdminScope, isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated()) {
    clearStoredToken();
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!hasAdminScope()) {
    // If the user is authenticated but does not have admin scope, redirect to home page.
    console.log("User lacks admin scope, redirecting to /about");
    return <Navigate to="/about" replace />;
  }

  return <>{children}</>;
};

export default AdminRoute;
