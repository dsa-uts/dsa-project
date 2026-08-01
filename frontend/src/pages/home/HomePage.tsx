import { useEffect, useState } from 'react'

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

// ホームのプレースホルダ。後続スライスで課題一覧などに置き換わる。
export function HomePage() {
  return (
    <main className="flex flex-col items-center gap-6 px-6 py-10">
      <h2 className="text-2xl font-bold">ホーム</h2>
      <HealthIndicator />
    </main>
  )
}
