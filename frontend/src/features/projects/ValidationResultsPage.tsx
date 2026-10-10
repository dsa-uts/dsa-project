import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Copy, FileText } from 'lucide-react'
import { $api } from '@/api/client'
import type { components } from '@/api/schema'
import { StatusBadge } from './ValidationStatus'
import { Button } from '@/components/ui/button'

type Status = components['schemas']['Status']
const statuses: Status[] = ['AC', 'WA', 'TLE', 'MLE', 'RE', 'OLE', 'IE', 'CE', 'SKIP']
const states = { pending: '待機中', running: '実行中', retrying: '再試行中', completed: '完了' }
const dateFormat = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

function CopyValue({ value, label, children }: { value: string; label: string; children: React.ReactNode }) {
  const [message, setMessage] = useState('')
  return <span className="relative inline-flex items-center gap-2 whitespace-nowrap">
    <span title={value} className="font-mono">{children}</span>
    <Button variant="outline" size="icon" aria-label={`${label}をコピー`} onClick={async () => {
      try { await navigator.clipboard.writeText(value); setMessage('コピーしました。') }
      catch { setMessage(`コピーできませんでした: ${value}`) }
    }}><Copy aria-hidden="true" /></Button>
    <span role="status" className="sr-only">{message}</span>
  </span>
}

export function ValidationResultsPage() {
  const [search, setSearch] = useSearchParams()
  const projectId = search.get('project_id') || undefined
  const rawStatus = search.get('status')
  const status = statuses.find((value): value is Status => value === rawStatus)
  const state = search.get('state') === 'incomplete' ? 'incomplete' : undefined
  const next = search.get('next') || undefined
  const prev = search.get('prev') || undefined
  const projects = $api.useQuery('get', '/api/projects', {}, { retry: false })
  const results = $api.useQuery('get', '/api/validation', {
    params: { query: { project_id: projectId, status, state, next, prev } },
  }, {
    retry: false,
    refetchInterval: query => !query.state.error && query.state.data?.requests.some(request => request.state !== 'completed') ? 5000 : false,
  })
  const selected = projects.data?.projects.find(project => project.id === projectId)
  const title = projectId ? selected?.name ?? '課題の結果' : 'All'
  const data = results.data
  useEffect(() => {
    if (!results.isError && data?.requests.length === 0 && (next || prev)) {
      const first = new URLSearchParams(search)
      first.delete('next'); first.delete('prev')
      setSearch(first, { replace: true })
    }
  }, [data, next, prev, results.isError, search, setSearch])
  const filterURL = (id?: string) => {
    const params = new URLSearchParams(search)
    params.delete('next'); params.delete('prev'); params.delete('project_id')
    if (id) params.set('project_id', id)
    return `/results${params.size ? `?${params}` : ''}`
  }
  const page = (direction: 'next' | 'prev', cursor: string) => {
    const params = new URLSearchParams(search)
    params.delete('next'); params.delete('prev'); params.set(direction, cursor)
    setSearch(params)
  }
  return <main className="mx-auto grid w-full max-w-screen-2xl flex-1 md:grid-cols-[15rem_minmax(0,1fr)]">
    <aside className="min-w-0 border-b bg-muted/30 p-3 md:border-r md:border-b-0 md:py-6">
      <nav aria-label="結果の課題絞り込み" className="flex gap-2 overflow-x-auto md:flex-col">
        {[{ id: '', name: 'All' }, ...projects.data?.projects ?? []].map(project => <Link key={project.id} to={filterURL(project.id || undefined)} aria-current={(projectId ?? '') === project.id ? 'page' : undefined} className="flex shrink-0 items-center gap-3 rounded-md border-l-4 border-transparent px-4 py-4 text-lg font-semibold hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-link aria-[current=page]:bg-link/10 aria-[current=page]:text-link md:break-words">
          <FileText className="size-5 shrink-0" aria-hidden="true" />{project.name}
        </Link>)}
      </nav>
      {projects.isPending && <p role="status" className="p-3">課題を読み込み中…</p>}
      {projects.isError && <div role="alert" className="space-y-2 p-3"><p>課題一覧を取得できませんでした。</p><Button variant="outline" onClick={() => void projects.refetch()}>課題を再読み込み</Button></div>}
    </aside>
    <div className="min-w-0 space-y-5 bg-card p-5 sm:p-8">
      <div><h1 className="break-words text-4xl font-bold">{title}</h1><p className="mt-2 text-muted-foreground">{projectId ? 'この課題' : '全課題'}の提出・最新順</p></div>
      <div className="flex flex-wrap items-center gap-6 rounded-md border bg-muted/30 p-5">
        <label htmlFor="result-filter" className="font-medium">全体結果</label>
        <select id="result-filter" className="h-11 min-w-48 rounded-md border bg-card px-4 focus-visible:ring-2 focus-visible:ring-ring" value={state ?? status ?? ''} onChange={event => {
          const params = new URLSearchParams(search)
          for (const key of ['status', 'state', 'next', 'prev']) params.delete(key)
          if (event.target.value) params.set(event.target.value === 'incomplete' ? 'state' : 'status', event.target.value)
          setSearch(params)
        }}>
          <option value="">すべて</option><option value="incomplete">未完了</option>
          {statuses.map(status => <option key={status}>{status}</option>)}
        </select>
      </div>
      {results.isPending && <p role="status">結果を読み込み中…</p>}
      {results.isError && <div role="alert" className="flex flex-wrap items-center gap-3"><p className="text-destructive">{results.error?.code === 404 ? '課題が見つからないか、公開されていません。' : '結果一覧を取得できませんでした。'}</p><Button variant="outline" onClick={() => void results.refetch()}>再読み込み</Button><Link to="/results" className="text-link underline">すべての結果へ</Link></div>}
      {data && <>
        {data.requests.length === 0 ? <p className="py-8 text-muted-foreground">該当する結果はありません。</p> : <div className="overflow-x-auto rounded-md border">
          <table aria-label="バリデーション結果" className="w-full text-left text-sm">
            <thead className="whitespace-nowrap bg-muted/30"><tr>{['リクエスト', '課題', '提出ユーザー', '全体結果', '提出ファイル SHA-256', '実行時間', 'リクエスト日時'].map(label => <th key={label} scope="col" className="px-4 py-5 font-semibold">{label}</th>)}</tr></thead>
            <tbody>{data.requests.map(request => <tr key={request.id} className="border-t">
              <td className="px-4 py-5"><CopyValue value={request.id} label="Request ID"><Link to={`/results/${request.id}`} className="text-link underline" aria-label={`Validation Result ${request.id}`}>{request.id.slice(0, 8)}…{request.id.slice(-4)}</Link></CopyValue></td>
              <td className="min-w-32 px-4 py-5"><span>{request.project.name}</span><span className="mt-1 block text-xs text-muted-foreground">{request.version}</span></td>
              <td className="min-w-32 px-4 py-5"><span>{request.subject_user.name}</span><span className="mt-1 block text-muted-foreground">{request.subject_user.userid}</span></td>
              <td className="whitespace-nowrap px-4 py-5">{request.state === 'completed' && request.status ? <StatusBadge status={request.status} /> : <span className="text-muted-foreground">{states[request.state]}</span>}</td>
              <td className="px-4 py-5"><CopyValue value={request.content_hash} label="SHA-256">{request.content_hash.replace(/^sha256:/, '').slice(0, 8)}…{request.content_hash.slice(-4)}</CopyValue></td>
              <td className="whitespace-nowrap px-4 py-5 tabular-nums">{request.duration_ms === null ? '—' : `${(request.duration_ms / 1000).toFixed(2)} s`}</td>
              <td className="whitespace-nowrap px-4 py-5 tabular-nums"><time dateTime={request.requested_at}>{dateFormat.format(new Date(request.requested_at))}</time></td>
            </tr>)}</tbody>
          </table>
        </div>}
        <nav aria-label="結果のページ移動" className="flex justify-end gap-3">
          <Button variant="outline" disabled={!data.prev} onClick={() => data.prev && page('prev', data.prev)}>Prev</Button>
          <Button variant="outline" disabled={!data.next} onClick={() => data.next && page('next', data.next)}>Next</Button>
        </nav>
      </>}
    </div>
  </main>
}
