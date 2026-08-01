import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { $api } from '@/api/client'
import { Button } from '@/components/ui/button'

export function LoginPage() {
  const [userid, setUserid] = useState('')
  const [password, setPassword] = useState('')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const login = $api.useMutation('post', '/api/session', {
    onSuccess: (user) => {
      // Layout の me クエリを即座に満たしてホームでの再フェッチ待ちをなくす。
      queryClient.setQueryData($api.queryOptions('get', '/api/me').queryKey, user)
      navigate('/', { replace: true })
    },
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (userid.trim() === '' || password === '') return
    login.mutate({ body: { userid, password } })
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background text-foreground">
      <section className="flex w-full max-w-sm flex-col gap-4 rounded-lg border bg-card px-6 py-6 shadow-sm">
        <h1 className="text-xl font-bold">ログイン</h1>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            ユーザーID
            <input
              type="text"
              value={userid}
              onChange={(event) => setUserid(event.target.value)}
              autoComplete="username"
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            パスワード
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
          {login.isError && (
            <p className="text-sm text-destructive">
              {login.error.error.code === 'invalid_credentials'
                ? 'ユーザーIDまたはパスワードが正しくありません'
                : 'ログインに失敗しました'}
            </p>
          )}
          <Button
            type="submit"
            disabled={login.isPending || userid.trim() === '' || password === ''}
          >
            ログイン
          </Button>
        </form>
      </section>
    </main>
  )
}
