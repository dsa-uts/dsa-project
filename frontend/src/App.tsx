import { useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { $api } from '@/api/client'
import { Button } from '@/components/ui/button'

interface HealthResponse {
  status: string
}

// backend の /health を叩いた結果。取得前は null。
type HealthState = HealthResponse | null

// /health は openapi.yaml の対象外 (インフラ疎通用) なので raw fetch のまま。
function HealthIndicator() {
  const [health, setHealth] = useState<HealthState>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/health')
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`)
        return res.json() as Promise<HealthResponse>
      })
      .then((body) => {
        if (!cancelled) setHealth({ status: body.status })
      })
      .catch(() => {
        if (!cancelled) setHealth({ status: 'unreachable' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const ok = health?.status === 'ok'

  return (
    <section className="flex items-center gap-3 rounded-lg border bg-card px-6 py-4 shadow-sm">
      <span
        className={`size-3 rounded-full ${
          health === null ? 'bg-muted-foreground/40' : ok ? 'bg-success' : 'bg-destructive'
        }`}
        aria-hidden="true"
      />
      <p>
        backend health:{' '}
        {health === null ? (
          <span className="text-muted-foreground">checking…</span>
        ) : (
          <span className={ok ? 'text-success' : 'text-destructive'}>{health.status}</span>
        )}
      </p>
    </section>
  )
}

// openapi.yaml → schema.d.ts → $api の contract pipeline 疎通確認用 (issue #95)。
// Auth スライス以降で /api/hello ごと削除される。
function Greetings() {
  const [name, setName] = useState('')
  const queryClient = useQueryClient()

  const list = $api.useQuery('get', '/api/hello')
  const create = $api.useMutation('post', '/api/hello', {
    onSuccess: () => {
      setName('')
      return queryClient.invalidateQueries({
        queryKey: $api.queryOptions('get', '/api/hello').queryKey,
      })
    },
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (name.trim() === '') return
    create.mutate({ body: { name } })
  }

  return (
    <section className="flex w-full max-w-md flex-col gap-4 rounded-lg border bg-card px-6 py-4 shadow-sm">
      <h2 className="text-lg font-semibold">Greetings</h2>
      <form onSubmit={submit} className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="name"
          aria-label="name"
          className="h-9 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <Button type="submit" disabled={create.isPending || name.trim() === ''}>
          Greet
        </Button>
      </form>
      {create.isError && (
        <p className="text-sm text-destructive">failed to create greeting</p>
      )}
      {list.isPending ? (
        <p className="text-sm text-muted-foreground">loading…</p>
      ) : list.isError ? (
        <p className="text-sm text-destructive">failed to load greetings</p>
      ) : list.data.greetings.length === 0 ? (
        <p className="text-sm text-muted-foreground">no greetings yet</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.data.greetings.map((greeting) => (
            <li key={greeting.id} className="text-sm">
              {greeting.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background text-foreground">
      <h1 className="text-4xl font-bold">Hello, DSA Project</h1>
      <HealthIndicator />
      <Greetings />
    </main>
  )
}

export default App
