import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth'

export function AdminPage() {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <main className="p-6"><h1 className="text-2xl font-semibold">403 Forbidden</h1><Link to="/" className="underline">Home</Link></main>

  return (
    <main className="container mx-auto flex-1 px-8 py-6">
      <h1 className="mb-4 text-3xl font-bold">Admin Page</h1>
      <ul className="list-inside list-disc space-y-2 text-xl text-link">
        <li><Link to="/admin/users" className="ml-4 hover:underline">User Management</Link></li>
        <li><Link to="/admin/users/bulk" className="ml-4 hover:underline">Batch User Registration</Link></li>
      </ul>
    </main>
  )
}
