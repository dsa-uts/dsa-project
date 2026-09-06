import { useNavigationGuard } from '@/components/navigation-guard'
import { Link } from 'react-router-dom'
import { $api } from '@/api/client'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'

export function TopBar() {
  const { canLeave } = useNavigationGuard()
  const { setUser } = useAuth()
  const logout = $api.useMutation('delete', '/api/session', {
    onSuccess: () => setUser(null),
  })

  return (
    <header className="shrink-0 bg-top-bar text-top-bar-foreground">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-8">
        <Link to="/" className="rounded-sm text-3xl font-bold outline-none focus-visible:ring-2 focus-visible:ring-top-bar-foreground">
          DSA
        </Link>
        <Button
          type="button"
          variant="ghost"
          className="h-11 text-base hover:bg-top-bar-foreground/15 hover:text-top-bar-foreground focus-visible:ring-top-bar-foreground"
          onClick={() => { if (canLeave()) logout.mutate({}) }}
          disabled={logout.isPending}
        >
          Logout
        </Button>
      </div>
      {logout.isError && (
        <p role="alert" className="bg-background px-4 py-3 text-sm text-destructive sm:px-8">
          Unable to log out. Please try again.
        </p>
      )}
    </header>
  )
}
