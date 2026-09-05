import { useState, type ReactNode, type SubmitEventHandler } from 'react'
import { Link, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AdminUsersPage } from '@/AdminUsers'
import { $api } from '@/api/client'
import { AuthLayout, ProtectedLayout, useAuth } from '@/auth'
import { TopBar } from '@/components/TopBar'
import { Button } from '@/components/ui/button'

function Page({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-background p-4 text-foreground">
      <section className="flex w-full max-w-sm flex-col gap-5 rounded-lg border bg-card p-6 shadow-sm">
        {children}
      </section>
    </main>
  )
}

function LoginPage() {
  const { authenticated, setUser } = useAuth()
  const [userid, setUserid] = useState('')
  const [password, setPassword] = useState('')
  const login = $api.useMutation('post', '/api/session', {
    onSuccess: (user) => {
      setUser(user)
    },
  })

  if (authenticated) return <Navigate to="/" replace />

  const submit: SubmitEventHandler = (event) => {
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

function HomePage() {
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

function NotFoundPage() {
  return (
    <Page>
      <h1 className="text-2xl font-semibold">404</h1>
      <p className="text-muted-foreground">Page not found.</p>
    </Page>
  )
}

function AuthenticatedLayout() {
  const auth = useAuth()
  return (
    <>
      <TopBar />
      <Outlet context={auth} />
    </>
  )
}

function App() {
  return (
    <div className="flex min-h-svh flex-col">
      <Routes>
        <Route element={<AuthLayout loadingElement={<Page>Loading...</Page>} />}>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedLayout />}>
            <Route element={<AuthenticatedLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </div>
  )
}

export default App
