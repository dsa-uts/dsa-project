import { expect, test } from 'vitest'
import { clipboardCells, emptyUser, hasUserData, writeCells } from './user-grid'

test('B3:C5 changes only the pasted rectangle and preserves row count and other fields', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ ...emptyUser(), userid: `s${i}`, username: `Name ${i}`, role: 'student', password: `password${i}` }))
  const next = writeCells(rows, { row: 2, col: 1 }, clipboardCells('佐藤\tstudent\r\n鈴木\tmanager\r\n高橋\tstudent\r\n'))
  expect(next).toHaveLength(8)
  expect(next.map((row) => row.userid)).toEqual(rows.map((row) => row.userid))
  expect(next.map((row) => row.password)).toEqual(rows.map((row) => row.password))
  expect(next.slice(2, 5).map((row) => [row.username, row.role])).toEqual([['佐藤', 'student'], ['鈴木', 'manager'], ['高橋', 'student']])
  expect(next.slice(0, 2)).toEqual(rows.slice(0, 2))
  expect(next.slice(5)).toEqual(rows.slice(5))
  expect(rows[2].username).toBe('Name 2')
})

test('clipboard preserves blanks, leading zeros, commas, quoted delimiters and escaped quotes', () => {
  expect(clipboardCells('001\t"a\tb"\t\r\n\t"line1\nline2 ""quote"""\t\r\n')).toEqual([['001', 'a\tb', ''], ['', 'line1\nline2 "quote"', '']])
  expect(clipboardCells('a,b')).toEqual([['a,b']])
  expect(clipboardCells('a\n\n')).toEqual([['a'], ['']])
  expect(clipboardCells('a\tb\nc')).toEqual([['a', 'b'], ['c', '']])
  expect(clipboardCells('')).toEqual([['']])
  expect(() => clipboardCells('"unfinished')).toThrow('引用符')
})

test('extends rows, clears empty cells and atomically rejects overflow or created rows', () => {
  const rows = [{ ...emptyUser(), userid: 'original' }, { ...emptyUser(), userid: 'created', created: true }]
  expect(() => writeCells(rows, { row: 0, col: 3 }, [['a', 'b']])).toThrow('最終列（password）')
  expect(() => writeCells(rows, { row: 0, col: 0 }, [['changed'], ['changed']])).toThrow('作成済み')
  expect(rows[0].userid).toBe('original')
  const next = writeCells(rows, { row: 4, col: 1 }, [['Name']])
  expect(next).toHaveLength(5)
  expect(next[2]).toEqual(emptyUser())
  expect(next.filter(hasUserData)).toHaveLength(3)
  expect(writeCells(next, { row: 4, col: 1 }, [['']])[4]).toMatchObject({ username: '' })
})
