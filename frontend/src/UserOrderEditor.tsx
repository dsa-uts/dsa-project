import { useState } from 'react'
import { fetchClient } from '@/api/client'
import type { components } from '@/api/schema'
import { Button } from '@/components/ui/button'

type User = components['schemas']['UserAccount']

export function UserOrderEditor({ users, onCancel, onSaved, onMismatch }: { users: User[]; onCancel: () => void; onSaved: () => Promise<void>; onMismatch: () => Promise<void> }) {
  const [order, setOrder] = useState(users)
  const [dragging, setDragging] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const move = (from: number, to: number) => {
    if (busy || from < 0 || to < 0 || to >= order.length) return
    const next = [...order]
    const [user] = next.splice(from, 1)
    next.splice(to, 0, user)
    setOrder(next)
  }
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await fetchClient.PATCH('/api/users/order', { body: { user_ids: order.map((user) => user.id) } })
      if (result.error) {
        if (result.error.error.code === 'user_ids_mismatch') await onMismatch()
        else setError(result.error.error.message)
        return
      }
      await onSaved()
    } catch { setError('並び順を保存できませんでした。再試行してください。') }
    finally { setBusy(false) }
  }
  return <section className="flex flex-col gap-4" aria-label="並び順の編集">
    <p role="status">並び順を編集中・変更は未保存です。全ユーザー（無効化済みを含む）を表示しています。</p>
    <p className="text-sm text-muted-foreground">ハンドルをドラッグするか、上下のボタンで移動してください。</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex gap-2"><Button disabled={busy} onClick={() => void save()}>保存</Button><Button variant="outline" disabled={busy} onClick={onCancel}>キャンセル</Button></div>
    <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm">
      <thead className="bg-muted"><tr>{['移動', 'User ID', 'Display name', 'Role', 'State'].map((title) => <th className="p-3" key={title}>{title}</th>)}</tr></thead>
      <tbody>{order.map((user, index) => <tr key={user.id} className="border-t" onDragOver={(event) => { if (dragging && !busy) event.preventDefault() }} onDrop={(event) => {
        event.preventDefault()
        move(order.findIndex((item) => item.id === dragging), index)
        setDragging(null)
      }}>
        <td className="flex items-center gap-2 p-3">
          <span draggable={!busy} onDragStart={() => setDragging(user.id)} onDragEnd={() => setDragging(null)} className="cursor-grab p-2" aria-label={`${user.userid} を移動`}>⠿</span>
          <Button variant="outline" aria-label={`${user.userid} を上へ`} disabled={busy || index === 0} onClick={() => move(index, index - 1)}>↑</Button>
          <Button variant="outline" aria-label={`${user.userid} を下へ`} disabled={busy || index === order.length - 1} onClick={() => move(index, index + 1)}>↓</Button>
        </td><td className="p-3">{user.userid}</td><td className="p-3">{user.name}</td><td className="p-3">{user.role}</td><td className="p-3">{user.disabled ? 'Disabled' : 'Active'}</td>
      </tr>)}</tbody>
    </table></div>
  </section>
}
