import { expect, test } from 'vitest'
import { importUsers, parsePastedUsers, usersCSV, validateUsers } from './bulk-users'

test('imports named columns, preserves names and passwords, normalizes identifiers and skips empty rows', () => {
  const rows = importUsers([
    [' Password ', 'ROLE', 'username', 'UserID', 'comment'],
    [' secret pass ', ' MANAGER ', ' 山田 ', ' AbC ', 'ignored'],
    ['', '', '', '', ''],
    ['', 'student', 'Student', 's01', ''],
  ])
  expect(rows[0]).toMatchObject({ userid: 'AbC', username: ' 山田 ', role: 'manager', password: ' secret pass ', created: false })
  expect(rows).toHaveLength(2)
  expect(rows[1].password).toMatch(/^[a-zA-Z0-9]{6}-[a-zA-Z0-9]{6}-[a-zA-Z0-9]{6}$/)
  expect(() => importUsers([['userid', 'username', 'role']])).toThrow()
  expect(() => importUsers([['userid', ' USERID ', 'username', 'role', 'password']])).toThrow()
})

test('paste uses fixed columns without headers and preflight catches every invalid pending row', () => {
  const rows = parsePastedUsers(' AbC \t 名前 \t STUDENT \t\r\n\t\t\t\r\nabc\tOther\tmanager\t password \nwrong\t\tADMIN\tshort')
  expect(rows).toHaveLength(3)
  expect(rows[0]).toMatchObject({ userid: 'AbC', username: ' 名前 ', role: 'student' })
  const checked = validateUsers(rows)
  expect(checked[0].error).toBeUndefined()
  expect(checked[1].error).toBeUndefined()
  expect(checked[2].error).toContain('username')
  expect(checked[2].error).toContain('role')
  expect(checked[2].error).toContain('password')
  expect(checked[0].password).toBe(rows[0].password)
  expect(validateUsers([rows[0], { ...rows[0] }]).every((row) => row.error?.includes('重複'))).toBe(true)
})

test('CSV includes all created rows, escapes values and leaves failed rows in position', () => {
  const rows = importUsers([['userid', 'username', 'role', 'password'], ['a', 'A,"B"', 'student', ' pass word '], ['b', 'B', 'student', 'password'], ['c', 'C', 'manager', 'password']])
  rows[0].created = true
  rows[2].created = true
  expect(usersCSV(rows)).toBe('userid,username,role,password\r\na,"A,""B""",student, pass word \r\n,,,\r\nc,C,manager,password\r\n')
})

test('CSV and Excel files preserve text and Excel selects only the first sheet', async () => {
  const { readUserFile } = await import('./bulk-users')
  const { utils, write } = await import('xlsx')
  const data = [['role', 'password', 'userid', 'username'], ['student', ' password ', '001', ' 名前 ']]
  const book = utils.book_new()
  utils.book_append_sheet(book, utils.aoa_to_sheet(data), 'First')
  utils.book_append_sheet(book, utils.aoa_to_sheet([['invalid']]), 'Ignored')
  const excel = new File([write(book, { type: 'array', bookType: 'xlsx' })], 'users.xlsx')
  expect(await readUserFile(excel)).toEqual([{ userid: '001', username: ' 名前 ', role: 'student', password: ' password ', created: false }])
  const csv = new File(['\uFEFFrole,password,userid,username\r\nstudent, password ,001," 名前, ""引用"" "\r\n'], 'users.csv')
  expect((await readUserFile(csv))[0]).toMatchObject({ userid: '001', username: ' 名前, "引用" ', password: ' password ' })
  await expect(readUserFile(new File(['userid,username,role\na,A,student'], 'invalid.csv'))).rejects.toThrow('password')
})
