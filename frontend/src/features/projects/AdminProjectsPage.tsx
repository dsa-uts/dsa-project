import { useEffect, useRef, useState, type SubmitEventHandler } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { $api, fetchClient } from '@/api/client'
import type { components } from '@/api/schema'
import { Button } from '@/components/ui/button'
import { useNavigationGuard } from '@/components/navigation-guard'
import { useAuth } from '@/lib/auth'

type Project = components['schemas']['Project']
type ScheduleField = 'published_at' | 'deadline'
const inputClass = 'h-10 w-full rounded-md border bg-background px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50'
const primaryClass = 'bg-top-bar text-top-bar-foreground hover:bg-top-bar-hover'
const screenReaderInstructions = { draggable: 'Space キーで行を持ち上げ、上下キーで移動、Space キーで確定、Escape キーで取り消します。' }

function jstInput(value: string | null) {
  return value === null ? '' : new Date(Date.parse(value) + 9 * 60 * 60 * 1000).toISOString().slice(0, 16)
}

function ProjectRow({ project, busy, onChange }: { project: Project; busy: boolean; onChange: (field: ScheduleField, value: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: project.id, disabled: busy })
  return <tr ref={setNodeRef} className={`relative border-t ${isDragging ? 'z-10 bg-accent shadow-lg' : 'bg-background'}`} style={{ transform: CSS.Translate.toString(transform), transition }}>
    <td className="p-3"><Button ref={setActivatorNodeRef} type="button" variant="ghost" size="icon" disabled={busy} className="touch-none cursor-grab text-muted-foreground active:cursor-grabbing" {...attributes} {...listeners} aria-label={`${project.name} を移動`}><GripVertical aria-hidden="true" /></Button></td>
    <th scope="row" className="p-3 font-medium">{project.name}</th>
    <td className="p-3">{project.resource_id}</td><td className="p-3">{project.latest_version}</td>
    {(['published_at', 'deadline'] as const).map((field) => <td key={field} className="p-3">
      <input type="datetime-local" className={`${inputClass} min-w-56`} aria-label={`${project.name} の${field === 'published_at' ? '公開日時' : '締切日時'}`} value={jstInput(project[field])} disabled={busy} onChange={(event) => onChange(field, event.target.value)} />
    </td>)}
  </tr>
}

function ProjectsScreen() {
  const queryClient = useQueryClient()
  const projects = $api.useQuery('get', '/api/projects', {}, { retry: false, refetchOnWindowFocus: false })
  const [draft, setDraft] = useState<Project[] | null>(null)
  const [resourceId, setResourceId] = useState('')
  const [version, setVersion] = useState('')
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const rows = draft ?? projects.data?.projects ?? []
  const dirty = draft !== null
  const { setGuard } = useNavigationGuard()
  useEffect(() => {
    setGuard({ active: dirty || busy, busy, message: '日時・表示順の変更は保存されません。このページを離れますか？' })
    return () => setGuard({ active: false, busy: false })
  }, [dirty, busy, setGuard])
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const changeSchedule = (id: string, field: ScheduleField, value: string) => {
    const timestamp = value ? new Date(`${value}+09:00`).toISOString() : null
    setDraft(rows.map((row) => row.id === id ? { ...row, [field]: timestamp } : row))
    setNotice('')
  }
  const finishDrag = ({ active, over }: DragEndEvent) => {
    setDragging(false)
    if (busy || !over || active.id === over.id) return
    const from = rows.findIndex((row) => row.id === active.id)
    const to = rows.findIndex((row) => row.id === over.id)
    if (from >= 0 && to >= 0) { setDraft(arrayMove(rows, from, to)); setNotice('') }
  }
  const reload = async () => {
    const result = await projects.refetch()
    if (result.isError) {
      setError('一覧を取得できませんでした。再読み込みしてください。')
      return false
    }
    return true
  }
  const save: SubmitEventHandler = async (event) => {
    event.preventDefault()
    if (working.current || !dirty || mismatch) return
    setError(''); setNotice('')
    if (rows.some((row) => row.published_at && row.deadline && Date.parse(row.published_at) > Date.parse(row.deadline))) {
      setError('締切日時は公開日時以降に設定してください。')
      return
    }
    working.current = true; setBusy(true)
    try {
      const result = await fetchClient.PATCH('/api/admin/projects', { body: { projects: rows.map(({ id, published_at, deadline }) => ({ id, published_at, deadline })) } })
      if (result.error) {
        setMismatch(result.error.error.code === 'project_ids_mismatch')
        setError(result.error.error.code === 'project_ids_mismatch' ? '課題一覧が変更されています。編集を破棄して再読み込みし、もう一度変更してください。' : result.error.error.message)
        return
      }
      queryClient.setQueryData($api.queryOptions('get', '/api/projects', {}).queryKey, { projects: rows.map((row, display_order) => ({ ...row, display_order })) })
      setDraft(null)
      setNotice('日時・表示順を保存しました。')
      await reload()
    } catch { setError('保存できませんでした。通信を確認して再試行してください。') }
    finally { working.current = false; setBusy(false) }
  }
  const importResource: SubmitEventHandler = async (event) => {
    event.preventDefault()
    if (working.current || dirty) return
    working.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await fetchClient.POST('/api/admin/resource-imports', { body: { resource_id: resourceId, version } })
      if (result.error) { setError(result.error.error.message); return }
      setNotice(result.data.changed ? '新しいバージョンを登録しました。' : '同じバージョンが登録済みです。変更はありません。')
      await reload()
    } catch { setError('登録できませんでした。通信を確認して同じバージョンで再試行してください。') }
    finally { working.current = false; setBusy(false) }
  }
  return <main className="container mx-auto flex-1 space-y-8 px-4 py-6 sm:px-8" aria-busy={busy}>
    <div><nav aria-label="パンくず" className="mb-4 text-sm text-muted-foreground"><Link to="/admin/list" className="hover:underline">Admin Page</Link> / <span aria-current="page">Project Management</span></nav><h1 className="text-3xl font-bold">Project Management</h1></div>
    <form onSubmit={importResource} className="flex flex-wrap items-end gap-6 rounded-md border p-6" aria-label="新しいバージョンを登録">
      <h2 className="self-center text-xl font-bold">新しいバージョンを登録</h2>
      <label className="flex min-w-48 flex-1 flex-col gap-2 text-sm">リソースID<input className={inputClass} required pattern="[a-z][a-z0-9\-]*" placeholder="ex1" value={resourceId} disabled={busy || dirty} onChange={(event) => setResourceId(event.target.value)} /></label>
      <label className="flex min-w-48 flex-1 flex-col gap-2 text-sm">バージョン<input className={inputClass} required pattern="v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)" placeholder="v1.0.0" title="vMAJOR.MINOR.PATCH 形式（例: v1.0.0）" value={version} disabled={busy || dirty} onChange={(event) => setVersion(event.target.value)} /></label>
      <Button type="submit" className={`${primaryClass} h-10 px-8`} disabled={busy || dirty || dragging}>登録</Button>
      {dirty && <p className="w-full text-sm text-muted-foreground">登録する前に、日時・表示順の変更を保存またはキャンセルしてください。</p>}
    </form>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {notice && <p role="status" className="text-success">{notice}</p>}
    {projects.isError && projects.data && <Button variant="outline" disabled={busy} onClick={async () => { if (await reload()) setError('') }}>再読み込み</Button>}
    {mismatch && <Button variant="outline" disabled={busy} onClick={async () => {
      if (working.current) return
      working.current = true; setBusy(true)
      try { if (await reload()) { setDraft(null); setMismatch(false); setError('') } }
      finally { working.current = false; setBusy(false) }
    }}>編集を破棄して再読み込み</Button>}
    <section aria-labelledby="projects-heading" className="space-y-4">
      <h2 id="projects-heading" className="text-2xl font-bold">課題一覧</h2>
      <div className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground"><p>ハンドルをドラッグして表示順を変更（Space・上下キーでも操作可能）</p><p>日時は JST</p></div>
      <p className="text-sm text-muted-foreground">公開日時が空欄の課題は未公開です。締切日時は空欄にできます。</p>
      {projects.isPending ? <p role="status">読み込み中…</p> : projects.isError && !projects.data ? <div role="alert"><p>課題一覧を取得できませんでした。</p><Button variant="outline" onClick={() => void projects.refetch()}>再読み込み</Button></div> : <form onSubmit={save} className="space-y-6">
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragStart={() => setDragging(true)} onDragEnd={finishDrag} onDragCancel={() => setDragging(false)} accessibility={{ screenReaderInstructions }}>
          <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-5xl text-left text-sm">
            <thead className="bg-muted"><tr>{['移動', '課題', 'リソースID', 'バージョン', '公開日時', '締切日時'].map((title) => <th key={title} scope="col" className="whitespace-nowrap p-3">{title}</th>)}</tr></thead>
            <tbody><SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>{rows.map((project) => <ProjectRow key={project.id} project={project} busy={busy} onChange={(field, value) => changeSchedule(project.id, field, value)} />)}</SortableContext></tbody>
          </table>{rows.length === 0 && <p className="p-6 text-muted-foreground">課題はまだ登録されていません。リソースIDとバージョンを指定して登録してください。</p>}</div>
        </DndContext>
        <div className="flex flex-wrap items-center justify-between gap-4"><p className="text-sm text-muted-foreground">日時・表示順の変更をまとめて保存{dirty ? '（未保存）' : ''}</p><div className="flex gap-3">
          <Button type="button" variant="outline" disabled={busy || dragging || !dirty} onClick={() => { setDraft(null); setError(''); setNotice('') }}>キャンセル</Button>
          <Button type="submit" className={primaryClass} disabled={busy || dragging || !dirty || mismatch}>変更を保存</Button>
        </div></div>
      </form>}
    </section>
  </main>
}

export function AdminProjectsPage() {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <main className="p-6"><h1 className="text-2xl font-semibold">403 Forbidden</h1><Link to="/" className="underline">Home</Link></main>
  return <ProjectsScreen />
}
