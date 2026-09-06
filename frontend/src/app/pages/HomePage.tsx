import { Link, Navigate } from 'react-router-dom'
import { Page } from '@/components/Page'
import { useAuth } from '@/lib/auth'

export function HomePage() {
  const { user } = useAuth()

  if (user === null) return <Navigate to="/login" replace />

  return (
    <Page>
      <h1 className="text-2xl font-semibold">DSA Project</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">Name</dt>
        <dd>{user.name}</dd>
        <dt className="text-muted-foreground">Role</dt>
        <dd>{user.role}</dd>
      </dl>
      {user.role === 'admin' && <Link to="/admin/users" className="underline">Manage users</Link>}
    </Page>
  )
}
