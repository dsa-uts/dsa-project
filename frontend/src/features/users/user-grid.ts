import { read, utils } from 'xlsx'
import { userColumns, type BulkUser } from './bulk-users'

export type Cell = { row: number; col: number }
export const emptyUser = (): BulkUser => ({ userid: '', username: '', role: '', password: '', created: false })
export const hasUserData = (row: BulkUser) => row.created || userColumns.some((column) => row[column] !== '')

// Keep empty rows and cells so pasting can clear values in the selected rectangle.
export function clipboardCells(text: string): string[][] {
  const book = read(text, { type: 'string', raw: true, FS: '\t' })
  const sheet = book.Sheets[book.SheetNames[0]]
  if (!sheet?.['!ref']) return [['']]
  const range = utils.decode_range(sheet['!ref'])
  range.e.c = Math.min(range.e.c, userColumns.length - 1)
  return utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', blankrows: true, range })
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
