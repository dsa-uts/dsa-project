import { Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { TopBar } from './TopBar'

export function AuthenticatedLayout() {
  const auth = useAuth()
  return (
    <>
      <TopBar />
      <Outlet context={auth} />
    </>
  )
}
