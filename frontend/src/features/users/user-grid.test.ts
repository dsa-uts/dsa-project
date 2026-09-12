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

test.each([
  ['', [['']]],
  ['\t', [['']]],
  ['a\n\n', [['a'], ['']]],
  ['a\n\t', [['a'], ['']]],
  ['a\tb\t', [['a', 'b']]],
  ['"unfinished', [['"unfinished']]],
])('handles empty cells and malformed input following SheetJS behavior %j', (text, expected) => {
  expect(clipboardCells(text)).toEqual(expected)
})

test('discards excess columns before padding the rectangle', () => {
  expect(clipboardCells('a\tb\tc\td\textra\nnext')).toEqual([
    ['a', 'b', 'c', 'd'],
    ['next', '', '', ''],
  ])
  expect(clipboardCells('a\tb\tc\td\t"ignored\ncell"\nnext')).toEqual([
    ['a', 'b', 'c', 'd'],
    ['next', '', '', ''],
  ])
  const cells = clipboardCells('\t'.repeat(1999) + '\n' + 'a\n'.repeat(1999))
  expect(cells).toHaveLength(2000)
  expect(cells.every((row) => row.length === 4)).toBe(true)
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

test.each(['\t\n\t\n\t', '\t\r\n\t\r\n\t\r\n', 'b\tb\nb\t\nb\tb'])('pastes a 3 by 2 rectangle including blank cells %j', (text) => {
  const cells = clipboardCells(text)
  const expected = text.startsWith('b') ? [['b', 'b'], ['b', ''], ['b', 'b']] : [['', ''], ['', ''], ['', '']]
  expect(cells).toEqual(expected)
  const rows = Array.from({ length: 5 }, () => ({ ...emptyUser(), userid: 'keep', username: 'old', role: 'student', password: 'keep-password' }))
  const next = writeCells(rows, { row: 1, col: 1 }, cells)
  expect(next.slice(1, 4).map((row) => [row.username, row.role])).toEqual(expected)
  expect(next.map((row) => row.userid)).toEqual(rows.map((row) => row.userid))
  expect(next.map((row) => row.password)).toEqual(rows.map((row) => row.password))
  expect(next[0]).toEqual(rows[0])
  expect(next[4]).toEqual(rows[4])
})
