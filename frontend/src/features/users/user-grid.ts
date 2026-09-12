import { userColumns, type BulkUser } from './bulk-users'

export type Cell = { row: number; col: number }
export const emptyUser = (): BulkUser => ({ userid: '', username: '', role: '', password: '', created: false })
export const hasUserData = (row: BulkUser) => row.created || userColumns.some((column) => row[column] !== '')

// TSV clipboard cells preserve empty fields, quoted tabs/newlines and literal commas.
export function clipboardCells(text: string): string[][] {
  const rows: string[][] = [[]]
  let cell = '', quoted = false, closed = false
  const field = () => { rows[rows.length - 1].push(cell); cell = ''; closed = false }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') { quoted = false; closed = true }
      else cell += ch
    } else if (ch === '\t') field()
    else if (ch === '\n' || ch === '\r') {
      field(); rows.push([])
      if (ch === '\r' && text[i + 1] === '\n') i++
    } else if (ch === '"' && cell === '' && !closed) quoted = true
    else {
      if (closed) throw new Error('引用符の後には区切り文字が必要です。')
      cell += ch
    }
  }
  if (quoted) throw new Error('引用符が閉じられていません。')
  field()
  if (/[\r\n]$/.test(text) && rows.length > 1) rows.pop()
  const width = Math.max(...rows.map((row) => row.length))
  return rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ''))
}

export function writeCells(rows: BulkUser[], start: Cell, cells: string[][]): BulkUser[] {
  if (start.col + cells[0].length > userColumns.length) throw new Error('貼り付け範囲が最終列（password）を超えています。')
  if (rows.slice(start.row, start.row + cells.length).some((row) => row.created)) throw new Error('作成済みの行を含む範囲は変更できません。')
  const next = [...rows]
  while (next.length < start.row + cells.length) next.push(emptyUser())
  cells.forEach((values, offset) => {
    const row = { ...next[start.row + offset], error: undefined }
    values.forEach((value, col) => { row[userColumns[start.col + col]] = value })
    next[start.row + offset] = row
  })
  return next
}
