import { useMemo, useState } from 'react'
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type Row } from '@tanstack/react-table'
import { GripVertical } from 'lucide-react'
import { fetchClient } from '@/api/client'
import type { components } from '@/api/schema'
import { Button } from '@/components/ui/button'

type User = components['schemas']['UserAccount']

const columns: ColumnDef<User>[] = [
  { id: 'move', header: '移動' },
  { accessorKey: 'userid', header: 'User ID' },
  { accessorKey: 'name', header: 'Display name' },
  { accessorKey: 'role', header: 'Role' },
  { id: 'state', header: 'State', accessorFn: (user) => user.disabled ? 'Disabled' : 'Active' },
]
const screenReaderInstructions = {
  draggable: 'Space キーで行を持ち上げ、上下キーで移動します。Space キーで確定、Escape キーで取り消します。',
}

function SortableUserRow({ row, busy }: { row: Row<User>; busy: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled: busy })
  return <tr ref={setNodeRef}
    className={`relative border-t ${isDragging ? 'z-10 bg-accent shadow-lg' : 'bg-background'}`}
    style={{ transform: CSS.Translate.toString(transform), transition }}>
    {row.getVisibleCells().map((cell) => <td key={cell.id} className="p-3">
      {cell.column.id === 'move' ? <Button
        ref={setActivatorNodeRef}
        type="button" variant="ghost" size="icon" disabled={busy}
        className="touch-none cursor-grab active:cursor-grabbing"
        {...attributes} {...listeners}
        aria-label={`${row.original.userid} を移動`}>
        <GripVertical aria-hidden="true" />
      </Button> : flexRender(cell.column.columnDef.cell, cell.getContext())}
    </td>)}
  </tr>
}

export function UserOrderEditor({ users, onCancel, onSaved, onMismatch }: { users: User[]; onCancel: () => void; onSaved: () => Promise<void>; onMismatch: () => Promise<void> }) {
  const [order, setOrder] = useState(users)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ids = useMemo(() => order.map((user) => user.id), [order])
  const table = useReactTable({ data: order, columns, getCoreRowModel: getCoreRowModel(), getRowId: (user) => user.id })
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const finishDrag = ({ active, over }: DragEndEvent) => {
    setDragging(false)
    if (busy || !over || active.id === over.id) return
    setOrder((current) => {
      const from = current.findIndex((user) => user.id === active.id)
      const to = current.findIndex((user) => user.id === over.id)
      return from < 0 || to < 0 ? current : arrayMove(current, from, to)
    })
  }
  const describePosition = (id: string | number) => `${order.find((user) => user.id === id)?.userid ?? ''}、${order.length} 行中 ${ids.indexOf(String(id)) + 1} 行目`
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await fetchClient.PATCH('/api/users/order', { body: { user_ids: ids } })
      if (result.error) {
        if (result.error.error.code === 'user_ids_mismatch') await onMismatch()
        else setError(result.error.error.message)
        return
      }
      await onSaved()
    } catch { setError('並び順を保存できませんでした。再試行してください。') }
    finally { setBusy(false) }
  }
  return <section className="flex flex-col gap-4" aria-label="並び順の編集" aria-busy={busy}>
    <p role="status">並び順を編集中・変更は未保存です。全ユーザー（無効化済みを含む）を表示しています。</p>
    <p className="text-sm text-muted-foreground">左端のハンドルをドラッグして移動できます。キーボードではハンドルにフォーカスし、Space で持ち上げ、上下キーで移動、Space で確定します。Escape で移動を取り消せます。</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex gap-2"><Button disabled={busy || dragging} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</Button><Button variant="outline" disabled={busy || dragging} onClick={onCancel}>キャンセル</Button></div>
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]}
      onDragStart={() => setDragging(true)} onDragEnd={finishDrag} onDragCancel={() => setDragging(false)}
      accessibility={{ screenReaderInstructions, announcements: {
        onDragStart: ({ active }) => `${describePosition(active.id)}を持ち上げました。`,
        onDragOver: ({ over }) => over ? `${ids.indexOf(String(over.id)) + 1} 行目へ移動します。` : '移動先がありません。',
        onDragEnd: ({ active, over }) => over ? `${order.find((user) => user.id === active.id)?.userid ?? ''}を ${ids.indexOf(String(over.id)) + 1} 行目に移動しました。` : '移動を取り消しました。',
        onDragCancel: () => '移動を取り消しました。',
      } }}>
      <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm">
        <thead className="bg-muted">{table.getHeaderGroups().map((group) => <tr key={group.id}>
          {group.headers.map((header) => <th key={header.id} scope="col" className="p-3">{flexRender(header.column.columnDef.header, header.getContext())}</th>)}
        </tr>)}</thead>
        <tbody><SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {table.getRowModel().rows.map((row) => <SortableUserRow key={row.id} row={row} busy={busy} />)}
        </SortableContext></tbody>
      </table></div>
    </DndContext>
  </section>
}
