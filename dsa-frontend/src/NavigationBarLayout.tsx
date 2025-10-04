import { Outlet } from "react-router"
import NavigationBar from "./components/NavigationBar"

const NavigationBarLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <NavigationBar />

      {/* Main content */}
      <div className="max-w-7xl mx-auto">
        <Outlet />
      </div>

    </div>
  )
}

export default NavigationBarLayout
