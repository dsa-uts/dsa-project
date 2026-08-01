import { Navigate, Outlet, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { $api } from '@/api/client'
import { Button } from '@/components/ui/button'

// 認証ガード付きレイアウト。GET /api/me で User Account を解決し、
// 未認証 (401) ならログインページへ送り返す。
export function Layout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // 401 は「未認証」という確定した答えなので retry しない。
  const me = $api.useQuery('get', '/api/me', undefined, { retry: false })

  const logout = $api.useMutation('delete', '/api/session', {
    onSuccess: () => {
      queryClient.removeQueries({
        queryKey: $api.queryOptions('get', '/api/me').queryKey,
      })
      navigate('/login', { replace: true })
    },
  })

  if (me.isPending) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">読み込み中…</p>
      </main>
    )
  }

  if (me.isError) {
    return <Navigate to="/login" replace />
  }

  const user = me.data

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="flex items-center justify-between border-b bg-card px-6 py-3">
        <h1 className="text-lg font-bold">DSA Project</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm">{user.name}</span>
          <span className="text-xs text-muted-foreground">{user.role}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => logout.mutate({})}
            disabled={logout.isPending}
          >
            ログアウト
          </Button>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
