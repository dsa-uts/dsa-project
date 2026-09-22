import { useNavigationGuard } from '@/components/navigation-guard'
import { Link } from 'react-router-dom'
import { $api } from '@/api/client'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'

export function TopBar() {
  const { canLeave } = useNavigationGuard()
  const { user, setUser } = useAuth()
  const logout = $api.useMutation('delete', '/api/session', {
    onSuccess: () => setUser(null),
  })

  return (
    <header className="shrink-0 bg-top-bar text-top-bar-foreground">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-2 px-4 py-2 sm:h-16 sm:flex-nowrap sm:gap-4 sm:px-8 sm:py-0">
        <Link to="/about" className="rounded-sm px-2 py-1 text-3xl font-bold outline-none transition-opacity hover:bg-top-bar-hover hover:opacity-80 focus-visible:ring-2 focus-visible:ring-top-bar-foreground">
          DSA
        </Link>
        <Link to="/projects" className="mr-auto rounded-sm px-2 py-2 outline-none hover:bg-top-bar-hover focus-visible:ring-2 focus-visible:ring-top-bar-foreground">
          Dashboard
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          {user?.role === 'admin' && (
            <Link to="/admin/list" className="rounded-sm px-2 py-2 outline-none transition-colors hover:bg-top-bar-hover focus-visible:ring-2 focus-visible:ring-top-bar-foreground sm:px-4">
              Admin
            </Link>
          )}
          <Button
            type="button"
            variant="ghost"
            className="h-auto rounded-sm text-base font-normal transition-colors hover:bg-top-bar-hover hover:text-top-bar-foreground focus-visible:ring-top-bar-foreground"
            onClick={() => { if (canLeave()) logout.mutate({}) }}
            disabled={logout.isPending}
          >
            Logout
          </Button>
        </div>
      </div>
      {logout.isError && (
        <p role="alert" className="bg-background px-4 py-3 text-sm text-destructive sm:px-8">
          Unable to log out. Please try again.
        </p>
      )}
    </header>
  )
}
