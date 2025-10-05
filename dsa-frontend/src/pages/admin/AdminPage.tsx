import { Link } from "react-router"

const AdminPage: React.FC = () => {
  return (
    <div className="container mx-auto px-8 py-6">
      <h1 className="text-3xl font-bold mb-4">Admin Page</h1>

      {/* List for pages Admin can visit. */}
      <ul className="list-disc list-inside space-y-2">
        <li className="text-blue-600 hover:underline">
          <Link to="/admin/user/list" className="ml-4">User Management</Link>
        </li>
        <li className="text-blue-600 hover:underline">
          <Link to="/admin/user/register/batch" className="ml-4">Batch User Registration</Link>
        </li>
      </ul>
    </div>
  )
}

export default AdminPage
