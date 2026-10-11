import { useId, useRef, useState, type SubmitEventHandler } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Upload, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { fetchClient } from '@/api/client'
import { Button } from '@/components/ui/button'
import { prepareFiles, submissionBody, type SubmissionFile } from './validation-files'

export function ValidationSubmitPanel({ projectId, projectName, requiredFiles }: { projectId: string; projectName: string; requiredFiles: string[] }) {
  const [open, setOpen] = useState(false)
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
        setError(result.response.status === 413
          ? '提出データが大きすぎます。ファイルの容量を減らしてください。'
          : typeof result.error === 'object' && result.error
            ? result.error.message
            : '提出できませんでした。もう一度お試しください。')
        return
      }
      void queryClient.invalidateQueries({ queryKey: ['get', '/api/validation'] })
      navigate('/results')
    } catch {
      setError('提出の受付を確認できませんでした。Resultsで履歴を確認してから再提出してください。')
    } finally {
      working.current = false;
      setBusy(false)
    }
  }
  return <Dialog.Root modal={false} open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild>
      <Button className="fixed right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 h-12 bg-top-bar px-5 text-top-bar-foreground shadow-lg hover:bg-top-bar-hover sm:right-8">
        <Upload aria-hidden="true" />課題を提出
      </Button>
    </Dialog.Trigger>
    <Dialog.Content aria-describedby={undefined} onInteractOutside={event => event.preventDefault()}
      className="absolute inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-card text-foreground shadow-xl sm:max-w-[25rem] motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:slide-in-from-right motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:slide-out-to-right">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b p-5">
        <Dialog.Title className="min-w-0 text-xl font-bold break-words">{projectName}を提出</Dialog.Title>
        <Dialog.Close asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="提出パネルを閉じる"><X aria-hidden="true" /></Button>
        </Dialog.Close>
      </div>
      <form onSubmit={submit} aria-label="課題を提出" className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {requiredFiles.length > 0 && <ul aria-label="提出が求められているファイル" className="rounded-md bg-muted p-3 font-mono text-sm">
            {requiredFiles.map((file, index) =>
              <li key={index} className="break-words whitespace-pre-wrap">{file}</li>
            )}
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
            <span className="text-sm">ファイル・ZIPをドロップ</span>
            <span className="text-sm">または</span>
            <input ref={input} id={inputId} type="file" multiple className="sr-only" aria-label="提出ファイル" disabled={busy} onChange={event => {
              const selected = Array.from(event.target.files ?? [])
              event.target.value = ''
              void select(selected)
            }} />
            <Button
              type="button"
              variant="outline"
              disabled={busy} onClick={() => input.current?.click()}>
              ファイルを選択
            </Button>
          </div>
          {files.length ?
            <ul aria-label="選択したファイル" className="space-y-2 text-sm">
              {files.map(file =>
                <li key={file.path} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-all font-mono">{file.path}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={`${file.path} を削除`}
                    onClick={() => {
                      setFiles(files.filter(item => item.path !== file.path));
                      setError('')
                    }}>
                    <X aria-hidden="true" />
                  </Button>
                </li>)}
            </ul>
            : <p className="text-sm text-muted-foreground">未選択</p>
          }
          <p className="text-sm text-muted-foreground">最大50ファイル・合計20 MB（ZIPは展開後）</p>
          {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
        </div>
        <div className="shrink-0 border-t p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <Button
            type="submit"
            className="h-11 w-full bg-top-bar text-top-bar-foreground hover:bg-top-bar-hover"
            disabled={busy || !files.length}>
            {busy ? '処理中…' : '提出する'}
          </Button>
        </div>
      </form>
    </Dialog.Content>
  </Dialog.Root>
}
