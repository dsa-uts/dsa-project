import { Fragment, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { $api } from '@/api/client'
import type { components } from '@/api/schema'
import { Button } from '@/components/ui/button'
import { ResultFilePanel } from './ResultFilePanel'
import { decodeOutput, loadResultFiles } from './validation-detail-files'
import { StatusBadge } from './ValidationStatus'

type Step = components['schemas']['ValidationStep']
const states = { pending: '待機中', running: '実行中', retrying: '再試行中', completed: '実行完了' }
const memory = (bytes: number | null | undefined) => bytes == null ? '—' : `${(bytes / 1_000_000).toFixed(1)} MB`
const duration = (ms: number | null) => ms === null ? '—' : `${ms} ms`
const outputClass = 'min-h-10 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-card p-3 font-mono text-sm'

function Output({ label, actual, expected }: { label: string; actual: Step['stdout']; expected: Step['expected']['stdout'] }) {
  const [diff, setDiff] = useState(false)
  const value = actual === null ? '未記録' : decodeOutput(actual.data)
  const wanted = expected === null ? '指定なし（比較しません）' : decodeOutput(expected.data)
  // shortcut: compare line positions; align inserted lines if large output diffs become common.
  const left = value.split('\n'), right = wanted.split('\n')
  return <section className="space-y-2">
    <div className="flex flex-wrap items-center gap-3"><h4 className="font-semibold">{label}</h4>{actual && expected && <Button size="sm" variant="outline" aria-pressed={diff} onClick={() => setDiff(!diff)}>Diff View</Button>}{expected && <span className="text-sm text-muted-foreground">比較方式: {expected.match}</span>}</div>
    {actual?.truncated && <p className="text-destructive">出力は上限で切り詰められています。</p>}
    {diff && <p className="text-sm text-muted-foreground">行位置ごとの差分です。空白を含めて比較しています。</p>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="min-w-0"><p className="mb-1 text-sm text-muted-foreground">{label}</p><pre className={outputClass}>{diff ? left.map((line, i) => <span key={i} className={`block min-h-5 ${line !== right[i] ? 'bg-destructive/10' : ''}`}>{line !== right[i] ? '− ' : '  '}{line}</span>) : value || '(空の出力)'}</pre></div>
      <div className="min-w-0"><p className="mb-1 text-sm text-muted-foreground">{label}, expected</p><pre className={outputClass}>{diff ? right.map((line, i) => <span key={i} className={`block min-h-5 ${line !== left[i] ? 'bg-success/10' : ''}`}>{line !== left[i] ? '+ ' : '  '}{line}</span>) : wanted || '(空の出力)'}</pre></div>
    </div>
  </section>
}

function StepRow({ step }: { step: Step }) {
  const [open, setOpen] = useState(false)
  return <>
    <tr className="border-t"><td className="p-3"><Button variant="ghost" size="icon" aria-expanded={open} aria-label={`${step.name || `Step #${step.index + 1}`} の詳細`} onClick={() => setOpen(!open)}><ChevronDown aria-hidden="true" className={open ? 'rotate-180' : '-rotate-90'} /></Button></td>
      <th scope="row" className="min-w-40 p-3 text-left font-medium">{step.name || `Step #${step.index + 1}`}</th><td className="p-3"><StatusBadge status={step.status} /></td><td className="whitespace-nowrap p-3 tabular-nums">{duration(step.duration_ms)}</td><td className="whitespace-nowrap p-3 tabular-nums">{memory(step.memory_bytes)}</td></tr>
    {open && <tr><td colSpan={5} className="bg-muted/40 p-4"><div className="space-y-4">
      <h3 className="font-bold">Step #{step.index + 1}</h3>
      {step.status === null && <p className="text-muted-foreground">実行結果が記録されていません。未実行とは限りません。</p>}
      <p>Exit code: {step.exit_code ?? '未記録'} (expected: {step.expected.exit_code ?? '指定なし'})</p>
      <div><p className="mb-1 font-semibold">Command{step.compile && ' (compile)'}</p><pre className={outputClass}>{step.run}</pre><p className="mt-1 text-sm text-muted-foreground">タイムアウト: {duration(step.timeout_ms)}</p></div>
      <div><h4 className="mb-1 font-semibold">標準入力 (stdin)</h4><pre className={outputClass}>{step.stdin === '' ? '(No stdin)' : decodeOutput(step.stdin)}</pre></div>
      <Output label="標準出力 (stdout)" actual={step.stdout} expected={step.expected.stdout} />
      <Output label="標準エラー出力 (stderr)" actual={step.stderr} expected={step.expected.stderr} />
    </div></td></tr>}
  </>
}

export function ValidationDetailPage() {
  const { requestId = '' } = useParams()
  const [search] = useSearchParams()
  const detail = $api.useQuery('get', '/api/requests/{request_id}/validation', { params: { path: { request_id: requestId } } }, {
    retry: false, refetchInterval: query => !query.state.error && query.state.data?.state !== 'completed' ? 5000 : false,
  })
  const data = detail.data
  const files = useQuery({ queryKey: ['validation-files', requestId], queryFn: ({ signal }) => loadResultFiles(requestId, 'files', signal), enabled: !!data, retry: false })
  const artifacts = useQuery({ queryKey: ['validation-artifacts', requestId], queryFn: ({ signal }) => loadResultFiles(requestId, 'artifacts', signal), enabled: data?.state === 'completed', retry: false })
  const workflows = data?.result?.workflows ?? []
  const workflow = workflows.find(item => item.id === search.get('workflow')) ?? workflows[0]
  const projectURL = data ? `/projects/${data.project.id}` : '/projects'
  return <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 space-y-6 p-4 sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="min-w-0 break-all text-2xl font-bold sm:text-3xl">Validation Result #{requestId}</h1><div className="flex gap-4 text-sm"><Link to="/results" className="text-link underline">結果一覧に戻る</Link>{data && <Link to={projectURL} className="text-link underline">課題説明に戻る</Link>}</div></div>
    {detail.isPending && <p role="status">結果を読み込み中…</p>}
    {detail.isError && <div role="alert" className="flex flex-wrap items-center gap-3"><p className="text-destructive">{detail.error?.code === 404 ? '結果が見つからないか、閲覧できません。' : '結果を取得できませんでした。'}</p><Button variant="outline" onClick={() => void detail.refetch()}>再読み込み</Button></div>}
    {data && <>
      <ResultFilePanel key={`${requestId}-submission`} title="提出ファイル" files={files.data?.submission ?? []} pending={files.isPending} error={files.isError} retry={() => void files.refetch()} archiveName={`submission-${requestId}.zip`} />
      <dl className="text-sm">{[
        ['リクエスト日時', <time key="date" dateTime={data.requested_at}>{new Date(data.requested_at).toLocaleString('ja-JP')}</time>],
        ['提出者', `${data.subject_user.name}（${data.subject_user.userid}）`], ['全体の状態', states[data.state]], ['結果', <StatusBadge key="status" status={data.status} />],
        ['所要時間', data.duration_ms === null ? '—' : `${(data.duration_ms / 1000).toFixed(2)}秒`], ['メモリ使用量（ピーク）', memory(data.result?.peak_memory_bytes)],
        ['問題', <Fragment key="project"><Link to={projectURL} className="text-link underline">{data.project.name}</Link> <span className="text-muted-foreground">(ver: {data.version})</span></Fragment>],
        ['提出ファイル SHA-256', <span key="hash" className="break-all font-mono text-xs">{data.content_hash.replace(/^sha256:/, '')}</span>],
      ].map(([label, value], index) => <div key={index} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 border-b py-2 sm:grid-cols-[12rem_minmax(0,1fr)]"><dt className="font-medium">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}</dl>
      {data.state !== 'completed' && <p role="status" className="rounded-md border bg-muted/30 p-4">{states[data.state]}です。結果は5秒ごとに更新されます。</p>}
      {data.state === 'completed' && !workflows.length && <p>Workflowの結果はありません。</p>}
      {workflow && <>
        <section aria-label="ワークフロー" className="space-y-3"><h2 className="text-xl font-bold">ワークフロー</h2>
          <nav aria-label="結果のワークフロー" className="flex flex-wrap gap-2 border-b">{workflows.map(item => <Link key={item.id} to={`?${new URLSearchParams({ workflow: item.id })}`} aria-current={item.id === workflow.id ? 'page' : undefined} className="flex items-center gap-3 border-b-2 border-transparent px-3 py-3 font-semibold hover:bg-accent aria-[current=page]:border-link aria-[current=page]:text-link">{item.name}<StatusBadge status={item.status} /></Link>)}</nav>
          <p className="text-sm text-muted-foreground">ワークフローID: {workflow.id} · {duration(workflow.duration_ms)}</p>
        </section>
        <ResultFilePanel key={`${requestId}-${workflow.id}-artifacts`} title="Artifacts" files={artifacts.data?.artifacts.filter(file => file.workflowId === workflow.id) ?? []} pending={artifacts.isPending} error={artifacts.isError} retry={() => void artifacts.refetch()} archiveName={`artifacts-${workflow.id}.zip`} />
        {workflow.jobs.some(job => job.artifacts.length > 0) && <ul aria-label="Artifactの回収結果" className="space-y-2 text-sm">{workflow.jobs.flatMap(job => job.artifacts.map(artifact => <li key={`${job.id}/${artifact.name}`} className="rounded-md border p-3"><span className="break-all font-medium">{job.id} / {artifact.name} ({artifact.path})</span> · 回収結果: {artifact.status ?? '未記録'} · {artifact.available ? 'ファイルあり' : 'ファイルなし'}{artifact.error && <p className="text-destructive">{artifact.error}</p>}</li>))}</ul>}
        <section className="space-y-4"><h2 className="text-xl font-bold">ジョブの実行結果</h2>
          {!workflow.jobs.length && <p className="text-muted-foreground">公開Jobはありません。</p>}
          {workflow.jobs.map(job => <details key={`${requestId}-${workflow.id}-${job.id}`} open className="rounded-md border">
            <summary className="cursor-pointer rounded-md bg-muted/40 p-4"><span className="ml-2 inline-flex max-w-full flex-wrap items-center gap-3"><span className="text-sm text-muted-foreground">ジョブID</span><code className="break-all font-semibold">{job.id}</code>{job.name !== job.id && <span>{job.name}</span>}<StatusBadge status={job.status} /><span className="text-sm text-muted-foreground">{job.steps.length}ステップ · {duration(job.duration_ms)} · {memory(job.peak_memory_bytes)}</span></span></summary>
            {job.skip_reason && <p className="p-4">スキップ理由: {job.skip_reason}</p>}{job.stop_reason && <p className="p-4">停止理由: {job.stop_reason}</p>}
            <div className="overflow-x-auto"><table aria-label={`${job.name} のStep結果`} className="w-full text-left text-sm"><thead><tr>{['', '説明', '結果', '実行時間', 'メモリ'].map((label, index) => <th key={index} scope="col" className="p-3">{label}</th>)}</tr></thead><tbody>{job.steps.map(step => <StepRow key={step.index} step={step} />)}</tbody></table></div>
          </details>)}
        </section>
        <ResultFilePanel key={`${requestId}-${workflow.id}-presets`} title="プリセットファイル" files={files.data?.presets.filter(file => file.workflowId === workflow.id) ?? []} pending={files.isPending} error={files.isError} retry={() => void files.refetch()} archiveName={`presets-${workflow.id}.zip`} />
      </>}
    </>}
  </main>
}
