import { useState } from 'react'
import { Popover, Tabs, Tooltip } from 'radix-ui'
import { Check, CircleX, Clock, LoaderCircle, X } from 'lucide-react'
import { $api } from '@/api/client'
import type { components } from '@/api/schema'
import { Button } from '@/components/ui/button'

type Project = components['schemas']['Project']
type Status = components['schemas']['Status']
const statusClass: Record<Status, string> = {
  AC: 'text-status-ac', WA: 'text-status-wa', TLE: 'text-status-tle',
  MLE: 'text-status-mle', RE: 'text-status-re', OLE: 'text-status-ole', IE: 'text-status-ie',
}
const relativeTime = new Intl.RelativeTimeFormat('ja', { numeric: 'auto' })

function SubmittedAt({ value }: { value: string }) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000))
  const label = minutes < 60 ? relativeTime.format(-minutes, 'minute')
    : minutes < 1440 ? relativeTime.format(-Math.floor(minutes / 60), 'hour')
      : relativeTime.format(-Math.floor(minutes / 1440), 'day')
  return <time dateTime={value} title={new Date(value).toLocaleString('ja-JP')}>{label}</time>
}

function ResultIcon({ state, status }: { state: string; status: Status | null }) {
  const Icon = state === 'running' ? LoaderCircle : state !== 'completed' ? Clock : status === 'AC' ? Check : CircleX
  const label = state === 'running' ? '実行中' : state !== 'completed' ? '待機中' : status ?? '判定なし'
  return <span className={`inline-flex shrink-0 ${state === 'completed' && status ? statusClass[status] : 'text-muted-foreground'}`}>
    <Icon className={`size-6 ${state === 'running' ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" /><span className="sr-only">{label}</span>
  </span>
}

function SubmissionSummary({ project }: { project: Project }) {
  const result = project.my_result
  if (!result) return <span className="text-sm text-muted-foreground">実行結果なし</span>
  const { request } = result
  const completed = request.state === 'completed'
  const outdated = request.version_id !== project.latest_version_id
  const hash = result.content_hash.replace(/^sha256:/, '').slice(0, 7)
  const versionMessage = `旧Version ${request.version} の結果です。最新版は ${project.latest_version} です。`
  return <Popover.Root>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Popover.Trigger className={`inline-flex flex-wrap items-center gap-3 rounded-sm py-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${outdated ? 'border-b border-dashed border-muted-foreground' : ''}`} aria-label={`${project.name} の提出結果`}>
          <ResultIcon state={request.state} status={request.status} /><span className="font-mono">{hash}</span><span aria-hidden="true">·</span><SubmittedAt value={result.uploaded_at} />
        </Popover.Trigger>
      </Tooltip.Trigger>
      {outdated && <Tooltip.Portal><Tooltip.Content side="top" className="z-50 max-w-72 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">{versionMessage}<Tooltip.Arrow className="fill-popover" /></Tooltip.Content></Tooltip.Portal>}
    </Tooltip.Root>
    <Popover.Portal>
      <Popover.Content align="start" sideOffset={12} collisionPadding={16} aria-label={`${project.name} の提出結果`} className="z-40 max-h-[var(--radix-popover-content-available-height)] w-[min(48rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-popover text-popover-foreground shadow-lg">
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="space-y-2"><h3 className="text-xl font-bold">{project.name} の提出結果</h3>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span className="font-mono">{hash}</span><span>·</span><SubmittedAt value={result.uploaded_at} /><span>·</span><span>{completed ? `${request.workflows.filter((workflow) => workflow.status === 'AC').length} AC / ${request.workflows.length}` : '—'}</span></p>
          </div>
          <Popover.Close asChild><Button variant="ghost" size="icon" aria-label="提出結果を閉じる"><X aria-hidden="true" /></Button></Popover.Close>
        </div>
        <ul>{request.workflows.map((workflow) => <li key={workflow.id} className="grid grid-cols-[auto_minmax(0,1fr)_3rem_4.5rem] items-center gap-3 border-t bg-muted/50 px-5 py-4 sm:grid-cols-[auto_minmax(0,1fr)_3rem_5rem_auto]">
          <ResultIcon state={request.state} status={completed ? workflow.status : null} />
          <span className="min-w-0 break-words font-semibold">{workflow.name}</span>
          <span className={`font-semibold ${completed && workflow.status ? statusClass[workflow.status] : 'text-muted-foreground'}`}>{completed ? workflow.status ?? '—' : '—'}</span>
          <span className="text-right text-sm tabular-nums text-muted-foreground">{completed && workflow.duration_ms !== null ? `${(workflow.duration_ms / 1000).toFixed(2)} s` : '—'}</span>
          <button type="button" disabled title="詳細画面は準備中です" className="col-start-2 justify-self-start text-sm text-muted-foreground sm:col-start-auto sm:justify-self-end">Details</button>
        </li>)}</ul>
        <Popover.Arrow className="fill-popover" />
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}

export function ProblemListPage() {
  const [selected, setSelected] = useState('all')
  const projects = $api.useQuery('get', '/api/projects', {}, {
    retry: false,
    // Request詳細APIの実装までは、一覧のサマリーを再取得する。
    refetchInterval: (query) => !query.state.error && query.state.data?.projects.some((project) => project.my_result && project.my_result.request.state !== 'completed') ? 5000 : false,
  })
  const rows = projects.data?.projects ?? []
  const active = rows.some((project) => project.id === selected) ? selected : 'all'
  return <main className="mx-auto w-full max-w-screen-2xl flex-1 space-y-8 px-4 py-8 sm:px-12 sm:py-10">
    <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Problem List</h1>
    {projects.isPending && <p role="status" className="text-muted-foreground">読み込み中…</p>}
    {projects.isError && <div role="alert" className="flex flex-wrap items-center gap-4"><p className="text-destructive">課題一覧を取得できませんでした。</p><Button variant="outline" onClick={() => void projects.refetch()}>再読み込み</Button></div>}
    {projects.data && <Tabs.Root value={active} onValueChange={setSelected}>
      <Tabs.List aria-label="課題の絞り込み" className="flex overflow-x-auto border-b">
        {[{ id: 'all', name: 'All' }, ...rows].map((project) => <Tabs.Trigger key={project.id} value={project.id} className="shrink-0 border-b-2 border-transparent px-8 py-4 font-semibold outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=active]:border-link data-[state=active]:text-link">{project.name}</Tabs.Trigger>)}
      </Tabs.List>
      <Tabs.Content value={active} className="space-y-12 pt-10 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {rows.length === 0 && <p className="text-muted-foreground">表示できる課題はありません。</p>}
        <Tooltip.Provider>{rows.filter((project) => active === 'all' || project.id === active).map((project) => <section key={project.id} aria-labelledby={`project-${project.id}`} className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2"><h2 id={`project-${project.id}`} className="text-3xl font-bold">{project.name}</h2><SubmissionSummary project={project} /></div>
          {project.workflows.length > 0 ? <ul className="divide-y rounded-md border bg-card">{project.workflows.map((workflow) => <li key={workflow.id} className="px-6 py-5 font-semibold">{workflow.name}</li>)}</ul> : <p className="text-muted-foreground">問題はまだ登録されていません。</p>}
        </section>)}</Tooltip.Provider>
      </Tabs.Content>
    </Tabs.Root>}
  </main>
}
