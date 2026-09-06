import { useState, type SubmitEventHandler } from 'react'
import { Navigate } from 'react-router-dom'
import { $api } from '@/api/client'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'

export function LoginPage() {
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
