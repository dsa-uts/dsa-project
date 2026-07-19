import { useEffect, useState } from 'react'

interface HealthResponse {
  status: string
}

// backend の /health を叩いた結果。取得前は null。
type HealthState = HealthResponse | null

function App() {
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
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-slate-50 text-slate-900">
      <h1 className="text-4xl font-bold">Hello, DSA Project</h1>
      <section className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-6 py-4 shadow-sm">
        <span
          className={`size-3 rounded-full ${
            health === null ? 'bg-slate-300' : ok ? 'bg-emerald-500' : 'bg-red-500'
          }`}
          aria-hidden="true"
        />
        <p>
          backend health:{' '}
          {health === null ? (
            <span className="text-slate-500">checking…</span>
          ) : (
            <span className={ok ? 'text-emerald-600' : 'text-red-600'}>{health.status}</span>
          )}
        </p>
      </section>
    </main>
  )
}

export default App
