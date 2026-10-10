import { useEffect, useState } from 'react'
import { zipSync } from 'fflate'
import { Download, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MarkdownCodeBlock } from '@/components/MarkdownCodeBlock'
import './validation-detail.css'
import type { ResultFile } from './validation-detail-files'

function FileDownload({ file }: { file: ResultFile }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([file.content], { type: file.contentType ?? 'application/octet-stream' }))
    setUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return <div className="flex flex-wrap items-center gap-4 rounded-md border bg-muted/30 p-4">
    {url && /^image\/(png|jpeg|gif|webp)$/.test(file.contentType ?? '') && <img src={url} alt={file.path} className="max-h-40 max-w-48 object-contain" />}
    <FileText className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
    <div className="min-w-0 flex-1"><p className="break-all font-medium">{file.path}</p><p className="text-sm text-muted-foreground">{file.content.size.toLocaleString()} bytes{file.jobId && ` · 生成元ジョブ: ${file.jobId}`}</p></div>
    {url && <a href={url} download={file.path.split('/').at(-1)} className="text-link underline" aria-label={`${file.path} をダウンロード`}>ダウンロード</a>}
  </div>
}

export function ResultFilePanel({ title, files, pending, error, retry, archiveName }: {
  title: string; files: ResultFile[]; pending: boolean; error: boolean; retry: () => void; archiveName: string
}) {
  const [selected, setSelected] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const texts = files.filter(file => file.text !== null)
  const current = texts.find(file => file.part === selected) ?? texts[0]
  async function downloadAll() {
    try {
      setDownloadError('')
      const entries: Record<string, Uint8Array> = Object.create(null)
      for (const file of files) entries[file.jobId ? `${file.jobId}/${file.name}/${file.path}` : file.path] = new Uint8Array(await file.content.arrayBuffer())
      const url = URL.createObjectURL(new Blob([new Uint8Array(zipSync(entries))], { type: 'application/zip' }))
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = archiveName
      document.body.append(anchor); anchor.click(); anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setDownloadError('ダウンロードを準備できませんでした。') }
  }
  return <section aria-label={title} className="min-w-0 space-y-4 rounded-md border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{title}</h2>
      <Button variant="outline" disabled={!files.length} onClick={() => void downloadAll()}><Download aria-hidden="true" />一括ダウンロード</Button>
    </div>
    {pending && <p role="status">読み込み中…</p>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-3"><p>ファイルを取得できませんでした。</p><Button variant="outline" onClick={retry}>ファイルを再読み込み</Button></div>}
    {downloadError && <p role="alert" className="text-destructive">{downloadError}</p>}
    {!pending && !error && !files.length && <p className="text-muted-foreground">ファイルはありません。</p>}
    {current && <>
      <div className="flex flex-wrap items-center gap-4"><select aria-label={`${title}のファイル`} value={current.part} onChange={event => setSelected(event.target.value)} className="h-10 max-w-full min-w-0 rounded-md border bg-card px-3 sm:min-w-72">
        {texts.map(file => <option key={file.part} value={file.part}>{file.path}{file.jobId && ` (${file.jobId})`}</option>)}
      </select>{current.jobId && <span className="text-sm text-muted-foreground">生成元ジョブ: {current.jobId}</span>}</div>
      <div className="result-code max-h-96 overflow-auto rounded-md border bg-muted/30 p-4 font-mono text-sm"><MarkdownCodeBlock key={current.part}><code>{current.text?.split('\n').map((line, index, lines) => <span className="code-line" key={index}>{line}{index < lines.length - 1 ? '\n' : ''}</span>)}</code></MarkdownCodeBlock></div>
      <FileDownload key={current.part} file={current} />
    </>}
    {files.filter(file => file.text === null).map(file => <FileDownload key={file.part} file={file} />)}
  </section>
}
