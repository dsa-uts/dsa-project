import { useEffect, useMemo, useRef, useState } from 'react'
import { ContextMenu } from 'radix-ui'
import { cellSelectionFeature, createColumnHelper, tableFeatures, useTable, type CellSelectionDirection } from '@tanstack/react-table'
import { userColumns, type BulkUser } from './bulk-users'
import { clipboardCells, emptyUser, hasUserData, writeCells, type Cell } from './user-grid'

const features = tableFeatures({ cellSelectionFeature })
const columnHelper = createColumnHelper<typeof features, BulkUser>()
const columns = columnHelper.columns(userColumns.map((column) => columnHelper.accessor(column, { header: column })))
const initialSelection = [{ anchorRowId: '0', anchorColumnId: 'userid', focusRowId: '0', focusColumnId: 'userid' }]
const directions: Record<string, CellSelectionDirection> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'down' }
const menuItemClass = 'cursor-default rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50'

export function UserGrid({ rows, busy, onChange, onError, undo, redo }: {
  rows: BulkUser[]; busy: boolean
  onChange: (rows: BulkUser[], group?: object) => void
  onError: (message: string) => void
  undo: () => void; redo: () => void
}) {
  const [editing, setEditing] = useState(false)
  const group = useRef({})
  const root = useRef<HTMLDivElement>(null)
  const count = Math.max(10, rows.length + 1)
  const data = useMemo(() => Array.from({ length: count }, (_, i) => rows[i] ?? emptyUser()), [rows, count])
  const table = useTable({
    features, columns, data,
    initialState: { cellSelection: initialSelection },
    autoResetCellSelection: false,
    enableCellSelection: !busy,
    enableMultiCellRangeSelection: false,
  })
  useEffect(() => {
    table.setCellSelection((current) => current.some((range) => Number(range.anchorRowId) >= count || Number(range.focusRowId) >= count)
      ? current.map((range) => ({ ...range, anchorRowId: String(Math.min(Number(range.anchorRowId), count - 1)), focusRowId: String(Math.min(Number(range.focusRowId), count - 1)) }))
      : current)
  }, [count, table])
  const focus = () => {
    const cell = table.getFocusedCell()
    if (cell) root.current?.querySelector<HTMLInputElement>(`[data-cell="${cell.id}"]`)?.focus()
  }
  const focused = table.getFocusedCell()
  const position = { row: focused?.row.index ?? 0, col: userColumns.findIndex((column) => column === focused?.column.id) }
  const area = table.getCellSelectionBounds()[0]
  const includesCreated = !!area && rows.slice(area.minRowIndex, area.maxRowIndex + 1).some((row) => row.created)
  const changeSelectedRows = (action: 'before' | 'after' | 'delete') => {
    if (busy || !area || (action === 'delete' && includesCreated)) return
    const next = [...rows]
    const index = action === 'after' ? area.maxRowIndex + 1 : area.minRowIndex
    if (action === 'delete') next.splice(index, area.maxRowIndex - area.minRowIndex + 1)
    else {
      while (next.length < index) next.push(emptyUser())
      next.splice(index, 0, emptyUser())
    }
    onChange(next)
    onError('')
    setEditing(false)
    const rowId = String(Math.min(index, Math.max(10, next.length + 1) - 1))
    table.setCellSelection([{ anchorRowId: rowId, focusRowId: rowId, anchorColumnId: userColumns[area.minColumnIndex], focusColumnId: userColumns[area.maxColumnIndex] }])
  }
  const write = (start: Cell, cells: string[][], editGroup?: object) => {
    if (busy) return false
    try { onChange(writeCells(rows, start, cells), editGroup); onError(''); return true }
    catch (error) { onError(error instanceof Error ? error.message : 'セルを変更できませんでした。'); return false }
  }
  return <>
    <ContextMenu.Root onOpenChange={(open) => { if (open) setEditing(false) }}>
    <div ref={root} className="overflow-x-auto rounded-lg border bg-card" tabIndex={-1} aria-label="一括作成の表にセルを貼り付け"
      onPaste={(event) => {
        if (busy) { event.preventDefault(); return }
        const text = event.clipboardData.getData('text')
        if (editing && !/[\t\r\n]/.test(text)) return
        event.preventDefault()
        try {
          const cells = clipboardCells(text)
          if (!area) return
          const start = { row: area.minRowIndex, col: area.minColumnIndex }
          if (write(start, cells)) {
            setEditing(false)
            table.setCellSelection([{ anchorRowId: String(start.row), anchorColumnId: userColumns[start.col], focusRowId: String(start.row + cells.length - 1), focusColumnId: userColumns[start.col + cells[0].length - 1] }])
            focus()
          }
        } catch (error) { onError(error instanceof Error ? error.message : '貼り付けたセルを読み込めませんでした。') }
      }}
      onKeyDown={(event) => {
        if (busy || !focused || event.nativeEvent.isComposing) return
        if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase()) && !editing) {
          event.preventDefault(); if (event.shiftKey || event.key.toLowerCase() === 'y') redo(); else undo(); return
        }
        if (event.key === 'Escape') { setEditing(false); event.preventDefault(); return }
        if (editing && event.key !== 'Enter' && event.key !== 'Tab') return
        if ((event.key === 'Enter' && !editing) || event.key === 'F2') {
          event.preventDefault(); focus(); group.current = {}; setEditing(true); return
        }
        if (event.key === 'Tab' && ((event.shiftKey && position.row === 0 && position.col === 0) || (!event.shiftKey && position.row === count - 1 && position.col === userColumns.length - 1))) {
          setEditing(false)
          return
        }
        if (directions[event.key] || event.key === 'Tab') {
          event.preventDefault()
          setEditing(false)
          if (event.key === 'Tab') {
            const next = Math.max(0, Math.min(count * userColumns.length - 1, position.row * userColumns.length + position.col + (event.shiftKey ? -1 : 1)))
            table.setFocusedCell(String(Math.floor(next / userColumns.length)), userColumns[next % userColumns.length])
          } else if (event.shiftKey) table.extendCellSelection(directions[event.key])
          else table.moveCellSelection(directions[event.key])
          focus()
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault()
          if (area) write({ row: area.minRowIndex, col: area.minColumnIndex }, Array.from({ length: area.maxRowIndex - area.minRowIndex + 1 }, () => Array<string>(area.maxColumnIndex - area.minColumnIndex + 1).fill('')))
        } else if (event.key === 'Process' || event.key === 'Unidentified') {
          focus()
          group.current = {}; setEditing(true)
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          focus()
          group.current = {}; setEditing(true)
          event.preventDefault()
          write(position, [[event.key]], group.current)
        }
      }}>
      <table role="grid" className="w-full border-collapse text-left text-sm" aria-label="ユーザー入力" aria-busy={busy}>
        <thead className="bg-muted">{table.getHeaderGroups().map((headerGroup) => <tr key={headerGroup.id}><th scope="col" className="w-12 p-2">行</th>{headerGroup.headers.map((header) => <th scope="col" key={header.id} className="border-l p-2 font-medium"><table.FlexRender header={header} /></th>)}<th scope="col" className="min-w-40 border-l p-2">状態</th></tr>)}</thead>
        <tbody>{table.getRowModel().rows.map((tableRow) => {
          const row = tableRow.original
          const rowIndex = tableRow.index
          return <tr key={tableRow.id} className="border-t"><th scope="row" className="bg-muted p-2 text-center font-normal text-muted-foreground">{rowIndex + 1}</th>
            {tableRow.getAllCells().map((cell, col) => {
              const column = userColumns[col]
              const active = cell.getIsFocused()
              const selected = cell.getIsSelected()
              const edges = cell.getSelectionEdges()
              // Keep selection borders out of table layout so selecting cells cannot move the grid lines.
              return <ContextMenu.Trigger key={cell.id} asChild disabled={busy}><td role="gridcell" className={`relative border-l p-0 ${selected ? "bg-top-bar/10 after:pointer-events-none after:absolute after:-inset-px after:z-10 after:border-top-bar after:content-['']" : ''} ${edges.top ? 'after:border-t-2' : ''} ${edges.bottom ? 'after:border-b-2' : ''} ${edges.left ? 'after:border-l-2' : ''} ${edges.right ? 'after:border-r-2' : ''}`} aria-selected={selected}
                onContextMenu={() => {
                  if (busy || selected) return
                  table.setCellSelection([{ anchorRowId: tableRow.id, focusRowId: tableRow.id, anchorColumnId: column, focusColumnId: column }])
                }}
                onMouseDown={(event) => {
                  if (busy || event.button !== 0 || (editing && active)) return
                  event.preventDefault()
                  setEditing(false)
                  cell.getSelectionStartHandler()(event)
                  focus()
                }}
                onMouseEnter={cell.getSelectionExtendHandler()}>
                <input data-cell={cell.id} aria-label={`${rowIndex + 1}行目 ${column}`} autoComplete="off" value={row[column]} disabled={busy || row.created}
                  readOnly={!editing || !active} tabIndex={cell.getTabIndex()} placeholder={column === 'password' && hasUserData(row) ? '自動生成' : ''}
                  className="h-11 w-full min-w-36 rounded-none bg-transparent px-3 outline-none placeholder:text-muted-foreground disabled:text-muted-foreground"
                  onDoubleClick={() => { group.current = {}; setEditing(true) }}
                  onBlur={() => { setEditing(false); group.current = {} }}
                  onChange={(event) => { write({ row: rowIndex, col }, [[event.target.value]], group.current) }} />
              </td></ContextMenu.Trigger>
            })}
            <td className="border-l px-3 py-2">{row.created ? '作成済み' : hasUserData(row) ? '未作成' : ''}{row.error && <p role="alert" className="text-destructive">{row.error}</p>}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <ContextMenu.Portal>
      <ContextMenu.Content className="z-50 min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md" onCloseAutoFocus={(event) => { event.preventDefault(); focus() }}>
        <ContextMenu.Item className={menuItemClass} disabled={busy || !area} onSelect={() => changeSelectedRows('before')}>前に行を挿入</ContextMenu.Item>
        <ContextMenu.Item className={menuItemClass} disabled={busy || !area} onSelect={() => changeSelectedRows('after')}>後ろに行を挿入</ContextMenu.Item>
        <ContextMenu.Separator className="my-1 h-px bg-border" />
        <ContextMenu.Item className={menuItemClass} disabled={busy || !area || includesCreated} onSelect={() => changeSelectedRows('delete')}>選択した行を削除</ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Portal>
    </ContextMenu.Root>
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      <li>⌘ / Ctrl＋V：貼り付け</li>
      <li>Shift＋矢印 / ドラッグ：範囲選択</li>
      <li>右クリック：行の挿入・削除</li>
      <li>Delete：内容をクリア</li>
      <li>Enter / ダブルクリック：編集</li>
      <li>⌘ / Ctrl＋Z：元に戻す</li>
    </ul>
  </>
}
