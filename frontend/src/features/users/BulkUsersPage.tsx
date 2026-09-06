import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { $api, fetchClient } from '@/api/client'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { useNavigationGuard } from '@/components/navigation-guard'
import { parsePastedUsers, readUserFile, userColumns, usersCSV, validateUsers, type BulkUser } from './bulk-users'

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const working = useRef(false)
  const queryClient = useQueryClient()
  const { setGuard } = useNavigationGuard()
  useEffect(() => {
    setGuard({ active: rows.length > 0 || busy, busy })
    return () => setGuard({ active: false, busy: false })
  }, [rows.length, busy, setGuard])

  const apply = async () => {
    if (working.current) return
    const checked = validateUsers(rows)
    setRows(checked)
    setNotice('')
    if (checked.some((row) => !row.created && row.error)) return
    working.current = true
    setBusy(true)
    setError('')
    const next = [...checked]
    try {
      for (const [index, row] of next.entries()) {
        if (row.created || (row.role !== 'student' && row.role !== 'manager')) continue
        try {
          const result = await fetchClient.POST('/api/admin/users', { body: { userid: row.userid, name: row.username, role: row.role, password: row.password } })
          next[index] = result.error ? { ...row, error: result.error.error.message } : { ...row, created: true, error: undefined }
        } catch { next[index] = { ...row, error: '通信に失敗しました。再試行してください。' } }
        setRows([...next])
      }
      setNotice(`作成済み ${next.filter((row) => row.created).length} / ${next.length} 件`)
      downloadCSV(next)
    } catch { setError('CSV をダウンロードできませんでした。「CSV をダウンロード」から再試行してください。') }
    finally {
      working.current = false
      setBusy(false)
      void queryClient.invalidateQueries({ queryKey: $api.queryOptions('get', '/api/admin/users').queryKey })
    }
  }
  const append = (imported: BulkUser[]) => {
    setRows((current) => [...current, ...imported])
    setError(imported.length ? '' : '取り込む行がありません。')
    setNotice('')
  }
  return <main className="flex-1 bg-background p-6 text-foreground">
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <Link to="/admin/users" className="underline">User Accounts</Link>
      <h1 className="text-2xl font-semibold">ユーザーを一括作成</h1>
      <p className="text-sm text-muted-foreground">ヘッダーなしのセルを下の表へ貼り付けるか、CSV / .xlsx を読み込んでください。ファイルは userid・username・role・password のヘッダーが必須です。Excel は先頭シートを使用します。空の password は自動生成します。</p>
      <label className="flex flex-col gap-1 text-sm">CSV / Excel ファイル
        <input type="file" accept=".csv,.xlsx" disabled={busy} onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file || working.current) return
          working.current = true
          setBusy(true)
          try { append(await readUserFile(file)) }
          catch (error) { setError(error instanceof Error ? error.message : 'ファイルを読み込めませんでした。') }
          finally { working.current = false; setBusy(false) }
        }} />
      </label>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="overflow-x-auto rounded-lg border" tabIndex={0} aria-label="一括作成の表にセルを貼り付け" onPaste={(event) => {
        if (working.current) return
        // Single-cell edits remain native; a table paste appends complete rows.
        if (event.target instanceof HTMLInputElement && !/[\t\r\n]/.test(event.clipboardData.getData('text'))) return
        event.preventDefault()
        try { append(parsePastedUsers(event.clipboardData.getData('text'))) }
        catch { setError('貼り付けたセルを読み込めませんでした。') }
      }}>
        <table className="w-full text-left text-sm">
          <thead className="bg-muted"><tr><th className="p-2">行</th>{userColumns.map((column) => <th className="p-2" key={column}>{column}</th>)}<th className="p-2">状態</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index} className="border-t">
            <td className="p-2">{index + 1}</td>
            {userColumns.map((column) => <td key={column} className="p-2"><input className="h-10 w-full min-w-32 rounded-md border bg-background px-2" aria-label={`${index + 1}行目 ${column}`} autoComplete="off" value={row[column]} disabled={busy || row.created} onChange={(event) => setRows((current) => current.map((item, i) => i === index ? { ...item, [column]: event.target.value, error: undefined } : item))} /></td>)}
            <td className="p-2">{row.created ? '作成済み' : '未作成'}{row.error && <p role="alert" className="text-destructive">{row.error}</p>}</td>
          </tr>)}</tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-muted-foreground">ここを選択してセルを貼り付けてください（userid, username, role, password の順）。</p>}
      </div>
      <p className="text-sm text-muted-foreground">一覧とパスワードはこの画面を離れると失われます。Apply 完了時に作成済みユーザー全員の CSV をダウンロードします。未作成の行は空欄で出力します。</p>
      <div className="flex gap-2">
        <Button disabled={busy || !rows.some((row) => !row.created)} onClick={() => void apply()}>{busy ? '処理中…' : 'Apply'}</Button>
        <Button variant="outline" disabled={busy || !rows.some((row) => row.created)} onClick={() => {
          try { downloadCSV(rows) } catch { setError('CSV をダウンロードできませんでした。') }
        }}>CSV をダウンロード</Button>
      </div>
    </div>
  </main>
}

export function BulkUsersPage() {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <main className="p-6"><h1 className="text-2xl font-semibold">403 Forbidden</h1><Link to="/" className="underline">Home</Link></main>
  return <BulkUsersScreen />
}
