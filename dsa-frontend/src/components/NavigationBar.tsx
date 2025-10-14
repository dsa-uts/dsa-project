import { useLocation, useNavigate } from "react-router";
import { hasAdminScope, hasGradingScope, useLogout } from "../auth/hooks";

const NavigationBar = (): React.JSX.Element => {

  const { logout } = useLogout();

  const navigate = useNavigate();

  const location = useLocation();

  const handleDSAClick = () => {
    // Navigate to main page (implementation to be added)
    navigate("/about");
  };

  const handleDashboardClick = () => {
    navigate("/dashboard");
  }

  const handleResultsClick = () => {
    navigate("/validation/results");
  }

  const handleLogout = async () => {
    // Logout process (implementation to be added)
    await logout();
    navigate("/login", { state: { from: location } });
  };

  const handleAdminPageClick = () => {
    navigate("/admin/list");
  }

  const handleGradingMenuClick = () => {
    navigate("/grading/list");
  }

  return (
    <div className="bg-blue-500 text-white px-6 py-4 flex justify-between items-center">
      <div className="flex items-end space-x-10">
        <button
          key="dsa-button"
          onClick={handleDSAClick}
          className="hover:bg-blue-600 text-2xl font-bold hover:opacity-80 transition-opacity"
        >
          DSA
        </button>
        <button
          key="dashboard-button"
          onClick={handleDashboardClick}
          className="hover:bg-blue-600 font-semibold hover:opacity-80 transition-opacity"
        >
          Dashboard
        </button>
        <button
          key="results-button"
          onClick={handleResultsClick}
          className="hover:bg-blue-600 font-semibold hover:opacity-80 transition-opacity"
        >
          Results
        </button>
      </div>
      <div className="flex items-end space-x-4">
        {hasGradingScope() && (
          <button
            key="grading-menu-button"
            onClick={handleGradingMenuClick}
            className="hover:bg-blue-600 px-4 py-2 rounded transition-colors"
          >
            Grading
          </button>
        )
        }
        {hasAdminScope() && (
          <button
            key="admin-page-button"
            onClick={handleAdminPageClick}
            className="hover:bg-blue-600 px-4 py-2  rounded transition-colors"
          >
            Admin
          </button>
        )}
        <button
          key="logout-button"
          onClick={handleLogout}
          className="hover:bg-blue-600 px-4 py-2  rounded transition-colors"
        >
          Logout
        </button>
      </div>
    </div>
  )
}

export default NavigationBar;
