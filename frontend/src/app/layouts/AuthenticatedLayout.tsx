import { Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { TopBar } from './TopBar'

export function AuthenticatedLayout() {
  const auth = useAuth()
  return (
    <div className="fixed inset-0 flex flex-col overflow-clip">
      <TopBar />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet context={auth} />
      </div>
    </div>
  )
}
