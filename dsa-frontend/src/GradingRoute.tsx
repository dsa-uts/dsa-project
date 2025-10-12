import { Navigate, useLocation } from "react-router";
import { clearStoredToken, useAuth } from "./auth/hooks";

interface GradingRouteProps {
  children: React.ReactNode;
}

const GradingRoute: React.FC<GradingRouteProps> = ({ children }) => {
  const { hasGradingScope, isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated()) {
    clearStoredToken();
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!hasGradingScope()) {
    clearStoredToken();
    // If the user is authenticated but does not have grading scope, redirect to home page.
    return <Navigate to="/about" replace />;
  }

  return <>{children}</>;
}

export default GradingRoute;
