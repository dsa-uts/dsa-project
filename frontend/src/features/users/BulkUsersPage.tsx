import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { $api, fetchClient } from '@/api/client'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { FileUpload } from '@/components/ui/file-upload'
import { useNavigationGuard } from '@/components/navigation-guard'
import { readUserFile, usersCSV, validateUsers, type BulkUser } from './bulk-users'

import { UserGrid } from './UserGrid'
import { emptyUser, hasUserData } from './user-grid'

function downloadCSV(rows: BulkUser[]) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', usersCSV(rows)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'users.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function BulkUsersScreen() {
  const [rows, setRows] = useState<BulkUser[]>([])
  const history = useRef<{ past: BulkUser[][]; future: BulkUser[][]; group?: object }>({ past: [], future: [] })
  const changeRows = (next: BulkUser[], group?: object) => {
    if (working.current) return
    if (!group || history.current.group !== group) history.current.past = [...history.current.past.slice(-99), rows]
    history.current.future = []
    history.current.group = group
    setRows(next); setNotice('')
  }
  const travel = (direction: 'past' | 'future') => {
    if (working.current) return
    const next = history.current[direction].pop()
    if (!next) return
    history.current[direction === 'past' ? 'future' : 'past'].push(rows)
    history.current.group = undefined
    setRows(next); setError(''); setNotice('')
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const working = useRef(false)
  const queryClient = useQueryClient()
  const { setGuard } = useNavigationGuard()
  useEffect(() => {
    setGuard({ active: rows.some(hasUserData) || busy, busy, message: '一覧とパスワードは保存されません。このページを離れますか？' })
    return () => setGuard({ active: false, busy: false })
  }, [rows, busy, setGuard])

  const apply = async () => {
    if (working.current) return
    history.current = { past: [], future: [] }
    const validated = validateUsers(rows.filter(hasUserData))
    let position = 0
    const checked = rows.map((row) => hasUserData(row) ? validated[position++] : row)
    setRows(checked)
    setNotice('')
    if (checked.some((row) => !row.created && row.error)) return
    working.current = true
    setBusy(true)
    setError('')
    const next = [...checked]
    try {
      for (const [index, row] of next.entries()) {
        if (!hasUserData(row) || row.created || (row.role !== 'student' && row.role !== 'manager')) continue
        try {
          const result = await fetchClient.POST('/api/admin/users', { body: { userid: row.userid, name: row.username, role: row.role, password: row.password } })
          next[index] = result.error ? { ...row, error: result.error.error.message } : { ...row, created: true, error: undefined }
        } catch { next[index] = { ...row, error: '通信に失敗しました。再試行してください。' } }
        setRows([...next])
      }
      setNotice(`作成済み ${next.filter((row) => row.created).length} / ${next.filter(hasUserData).length} 件`)
      downloadCSV(next.filter(hasUserData))
    } catch { setError('CSV をダウンロードできませんでした。「CSV をダウンロード」から再試行してください。') }
    finally {
      working.current = false
      setBusy(false)
      void queryClient.invalidateQueries({ queryKey: $api.queryOptions('get', '/api/admin/users').queryKey })
    }
  }
  const append = (imported: BulkUser[]) => {
    history.current.past = [...history.current.past.slice(-99), rows]
    history.current.future = []
    history.current.group = undefined
    const next = [...rows]
    while (next.length && !hasUserData(next[next.length - 1])) next.pop()
    setRows([...next, ...imported])
    setError(imported.length ? '' : '取り込む行がありません。')
    setNotice('')
  }
  return <main className="container mx-auto flex-1 space-y-8 px-4 py-6 sm:px-8">
    <div><nav aria-label="パンくず" className="mb-4 text-sm text-muted-foreground"><Link to="/admin/list" className="hover:underline">Admin Page</Link> / <span aria-current="page">Batch User Registration</span></nav><h1 className="text-3xl font-bold">Batch User Registration</h1></div>
    <section aria-labelledby="bulk-users-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4"><h2 id="bulk-users-heading" className="text-2xl font-bold">ユーザー作成（一括）</h2><Link to="/admin/users" className="text-sm text-link hover:underline">User Management</Link></div>
      <div className="flex flex-wrap items-center gap-3 rounded-md border p-6">
        <Button variant="outline" disabled={busy} onClick={() => changeRows([...rows, ...Array.from({ length: Math.max(10, rows.length + 1) - rows.length }, emptyUser)])}>＋ 行を追加</Button>
        <Button variant="outline" disabled={busy || !history.current.past.length} onClick={() => travel('past')}>元に戻す</Button>
        <Button variant="outline" disabled={busy || !history.current.future.length} onClick={() => travel('future')}>やり直す</Button>
        <FileUpload className="ml-auto" label="CSV / Excel ファイル" accept=".csv,.xlsx" disabled={busy} onSelect={async (file) => {
          if (working.current) return
          working.current = true
          setBusy(true)
          try { append(await readUserFile(file)) }
          catch (error) { setError(error instanceof Error ? error.message : 'ファイルを読み込めませんでした。') }
          finally { working.current = false; setBusy(false) }
        }} />
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {notice && <p role="status" className="text-success">{notice}</p>}
      <UserGrid rows={rows} busy={busy} onChange={changeRows} onError={setError} undo={() => travel('past')} redo={() => travel('future')} />
      <div className="flex flex-wrap justify-end gap-3">
        <Button className="bg-top-bar text-top-bar-foreground hover:bg-top-bar-hover" disabled={busy || !rows.some((row) => hasUserData(row) && !row.created)} onClick={() => void apply()}>{busy ? '処理中…' : 'Apply'}</Button>
        <Button variant="outline" disabled={busy || !rows.some((row) => row.created)} onClick={() => {
          try { downloadCSV(rows.filter(hasUserData)) } catch { setError('CSV をダウンロードできませんでした。') }
        }}>CSV をダウンロード</Button>
      </div>
    </section>
  </main>
}

export function BulkUsersPage() {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <main className="p-6"><h1 className="text-2xl font-semibold">403 Forbidden</h1><Link to="/" className="underline">Home</Link></main>
  return <BulkUsersScreen />
}
