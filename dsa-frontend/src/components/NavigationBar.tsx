import { Link, useLocation, useNavigate } from "react-router";
import { hasAdminScope, hasGradingScope, useLogout } from "../auth/hooks";

const NavigationBar = (): React.JSX.Element => {

  const { logout } = useLogout();

  const navigate = useNavigate();

  const location = useLocation();

  const handleLogout = async () => {
    // Logout process (implementation to be added)
    await logout();
    navigate("/login", { state: { from: location } });
  };

  return (
    <div className="bg-blue-500 text-white px-6 py-4 flex justify-between items-center">
      <div className="flex items-end space-x-10">
        <Link
          to="/about"
          key="dsa-button"
          className="hover:bg-blue-600 px-2 py-1 text-2xl font-bold rounded hover:opacity-80 transition-opacity"
        >
          DSA
        </Link>
        <Link
          to="/dashboard"
          key="dashboard-button"
          className="hover:bg-blue-600 px-2 py-1 font-semibold rounded hover:opacity-80 transition-opacity"
        >
          Dashboard
        </Link>
        <Link
          to="/validation/results"
          key="results-button"
          className="hover:bg-blue-600 px-2 py-1 font-semibold rounded hover:opacity-80 transition-opacity"
        >
          Results
        </Link>
      </div>
      <div className="flex items-end space-x-4">
        {hasGradingScope() && (
          <Link
            to="/grading/list"
            key="grading-menu-button"
            className="hover:bg-blue-600 px-4 py-2 rounded transition-colors"
          >
            Grading
          </Link>
        )
        }
        {hasAdminScope() && (
          <Link
            to="/admin/list"
            key="admin-page-button"
            className="hover:bg-blue-600 px-4 py-2  rounded transition-colors"
          >
            Admin
          </Link>
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
