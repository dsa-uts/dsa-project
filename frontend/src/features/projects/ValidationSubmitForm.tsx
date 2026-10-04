import { useId, useRef, useState, type SubmitEventHandler } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Upload, X } from 'lucide-react'
import { fetchClient } from '@/api/client'
import { Button } from '@/components/ui/button'
import { prepareFiles, submissionBody, type SubmissionFile } from './validation-files'

export function ValidationSubmitForm({ projectId, requiredFiles }: { projectId: string; requiredFiles: string[] }) {
  const inputId = useId()
  const input = useRef<HTMLInputElement>(null)
  const working = useRef(false)
  const [busy, setBusy] = useState(false)
  const [files, setFiles] = useState<SubmissionFile[]>([])
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const select = async (selected: File[]) => {
    if (working.current || !selected.length) return
    working.current = true; setBusy(true); setError('')
    try { setFiles(await prepareFiles(selected, files)) }
    catch (error) { setError(error instanceof Error ? error.message : 'ファイルを読み込めませんでした。') }
    finally { working.current = false; setBusy(false) }
  }
  const submit: SubmitEventHandler = async (event) => {
    event.preventDefault()
    if (working.current || !files.length) return
    working.current = true; setBusy(true); setError('')
    try {
      const { metadata, form } = submissionBody(files)
      const result = await fetchClient.POST('/api/projects/{project_id}/validation', {
        params: { path: { project_id: projectId } },
        body: { metadata }, bodySerializer: () => form,
      })
      if (!result.response.ok) {
        setError(result.response.status === 413 ? '提出データが大きすぎます。ファイルの容量を減らしてください。'
          : typeof result.error === 'object' && result.error ? result.error.message : '提出できませんでした。もう一度お試しください。')
        return
      }
      void queryClient.invalidateQueries({ queryKey: ['get', '/api/validation'] })
      navigate('/results')
    } catch {
      setError('提出の受付を確認できませんでした。Resultsで履歴を確認してから再提出してください。')
    } finally { working.current = false; setBusy(false) }
  }
  return <form onSubmit={submit} aria-label="課題を提出" className="mt-8 space-y-4 rounded-md border bg-card p-4">
    <h2 className="text-xl font-bold">課題を提出</h2>
    {requiredFiles.length > 0 && <ul aria-label="提出が求められているファイル" className="rounded-md bg-muted p-3 font-mono text-sm">
      {requiredFiles.map((file, index) => <li key={index} className="break-words whitespace-pre-wrap">{file}</li>)}
    </ul>}
    <div onDragOver={event => event.preventDefault()} onDrop={event => {
      event.preventDefault()
      // Directory drops can silently flatten paths; use a ZIP to preserve its tree.
      if (Array.from(event.dataTransfer.items ?? []).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
        if (!working.current) setError('フォルダはZIPにまとめて選択してください。')
        return
      }
      void select(Array.from(event.dataTransfer.files))
    }} className="flex flex-col items-center gap-3 rounded-md border-2 border-dashed p-4 text-muted-foreground">
      <Upload className="size-8" aria-hidden="true" />
      <span className="text-sm">ファイル・ZIPをドロップ</span><span className="text-sm">または</span>
      <input ref={input} id={inputId} type="file" multiple className="sr-only" aria-label="提出ファイル" disabled={busy} onChange={event => {
        const selected = Array.from(event.target.files ?? [])
        event.target.value = ''
        void select(selected)
      }} />
      <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>ファイルを選択</Button>
    </div>
    {files.length ? <ul aria-label="選択したファイル" className="space-y-2 text-sm">
      {files.map(file => <li key={file.path} className="flex items-center justify-between gap-2"><span className="min-w-0 break-all font-mono">{file.path}</span><Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`${file.path} を削除`} onClick={() => { setFiles(files.filter(item => item.path !== file.path)); setError('') }}><X aria-hidden="true" /></Button></li>)}
    </ul> : <p className="text-sm text-muted-foreground">未選択</p>}
    <p className="text-sm text-muted-foreground">最大50ファイル・合計20 MB（ZIPは展開後）</p>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <Button type="submit" className="w-full bg-top-bar text-top-bar-foreground hover:bg-top-bar-hover" disabled={busy || !files.length}>{busy ? '処理中…' : '提出する'}</Button>
  </form>
}
