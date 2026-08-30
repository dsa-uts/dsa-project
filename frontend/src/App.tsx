import { useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { $api } from '@/api/client'
import { Button } from '@/components/ui/button'

type CurrentUser = {
  id: string
  userid: string
  name: string
  role: 'student' | 'manager' | 'admin'
}

const meQueryKey = $api.queryOptions('get', '/api/me', {}).queryKey

function Page({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 text-foreground">
      <section className="flex w-full max-w-sm flex-col gap-5 rounded-lg border bg-card p-6 shadow-sm">
        {children}
      </section>
    </main>
  )
}

function LoginPage({ authenticated }: { authenticated: boolean }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [userid, setUserid] = useState('')
  const [password, setPassword] = useState('')
  const login = $api.useMutation('post', '/api/session', {
    onSuccess: (user) => {
      queryClient.setQueryData(meQueryKey, user)
      navigate('/', { replace: true })
    },
  })

  if (authenticated) return <Navigate to="/" replace />

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    login.mutate({ body: { userid, password } })
  }

  return (
    <Page>
      <h1 className="text-2xl font-semibold">DSA Project</h1>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <label className="flex flex-col gap-1 text-sm">
          User ID
          <input
            autoComplete="username"
            className="h-10 rounded-md border bg-background px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={userid}
            onChange={(event) => setUserid(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            autoComplete="current-password"
            className="h-10 rounded-md border bg-background px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {login.isError && <p className="text-sm text-destructive">Invalid user ID or password.</p>}
        <Button type="submit" disabled={login.isPending || userid === '' || password === ''}>
          Log in
        </Button>
      </form>
    </Page>
  )
}

function HomePage({ user }: { user: CurrentUser }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const logout = $api.useMutation('delete', '/api/session', {
    onSuccess: () => {
      queryClient.setQueryData(meQueryKey, null)
      navigate('/login', { replace: true })
    },
  })
  return (
    <Page>
      <h1 className="text-2xl font-semibold">DSA Project</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">Name</dt>
        <dd>{user.name}</dd>
        <dt className="text-muted-foreground">Role</dt>
        <dd>{user.role}</dd>
      </dl>
      <Button variant="outline" onClick={() => logout.mutate({})} disabled={logout.isPending}>
        Log out
      </Button>
    </Page>
  )
}

function NotFoundPage() {
  return (
    <Page>
      <h1 className="text-2xl font-semibold">404</h1>
      <p className="text-muted-foreground">Page not found.</p>
    </Page>
  )
}

function App() {
  const me = $api.useQuery('get', '/api/me', {}, { retry: false })
  if (me.isPending) return <Page><p className="text-muted-foreground">Loading…</p></Page>

  const authenticated = !me.isError && me.data != null
  const user = me.data as CurrentUser | undefined
  const protectedRoute = (page: ReactNode) => authenticated ? page : <Navigate to="/login" replace />

  return (
    <Routes>
      <Route path="/login" element={<LoginPage authenticated={authenticated} />} />
      <Route path="/" element={protectedRoute(<HomePage user={user!} />)} />
      <Route path="*" element={protectedRoute(<NotFoundPage />)} />
    </Routes>
  )
}

export default App
