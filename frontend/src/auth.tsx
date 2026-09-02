import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, Outlet, useOutletContext } from 'react-router-dom'
import { $api } from '@/api/client'
import type { components } from '@/api/schema'

type CurrentUser = components['schemas']['CurrentUser']

type AuthContext = {
  user: CurrentUser | null
  authenticated: boolean
  setUser: (user: CurrentUser | null) => void
}

const currentUserQueryKey = $api.queryOptions('get', '/api/me', {}).queryKey

export function AuthLayout({ loadingElement }: { loadingElement: ReactNode }) {
  const queryClient = useQueryClient()
  const me = $api.useQuery('get', '/api/me', {}, { retry: false })

  if (me.isPending) return loadingElement

  const user = me.isError ? null : me.data
  const auth = {
    user,
    authenticated: user !== null,
    setUser: (nextUser: CurrentUser | null) => {
      queryClient.setQueryData(currentUserQueryKey, nextUser)
    },
  } satisfies AuthContext

  return <Outlet context={auth} />
}

export function ProtectedLayout() {
  const auth = useAuth()

  return auth.authenticated
    ? <Outlet context={auth} />
    : <Navigate to="/login" replace />
}

// Auth layouts and their consumer hook intentionally form one module interface.
// oxlint-disable-next-line react/only-export-components
export function useAuth() {
  return useOutletContext<AuthContext>()
}
