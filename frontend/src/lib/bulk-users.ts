import { read, utils } from 'xlsx'

export const userColumns = ['userid', 'username', 'role', 'password'] as const
export type BulkUser = Record<typeof userColumns[number], string> & { created: boolean; error?: string }

function generatePassword(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let value = ''
  // Reject the biased tail: 248 is the largest multiple of 62 below 256.
  while (value.length < 18) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < 248 && value.length < 18) value += alphabet[byte % 62]
    }
  }
  return [value.slice(0, 6), value.slice(6, 12), value.slice(12)].join('-')
}

function toUser(cells: string[]): BulkUser {
  return { userid: (cells[0] ?? '').trim(), username: cells[1] ?? '', role: (cells[2] ?? '').trim().toLowerCase(), password: cells[3] || generatePassword(), created: false }
}

export function importUsers(data: string[][]): BulkUser[] {
  const headers = (data[0] ?? []).map((cell) => cell.trim().toLowerCase())
  const indexes = userColumns.map((column) => {
    if (headers.filter((header) => header === column).length !== 1) throw new Error(`ヘッダー ${column} は1つ必要です。`)
    return headers.indexOf(column)
  })
  return data.slice(1).filter((cells) => cells.some((cell) => cell !== '')).map((cells) => toUser(indexes.map((index) => cells[index] ?? '')))
}

export function parsePastedUsers(text: string): BulkUser[] {
  const book = read(text, { type: 'string', raw: true, FS: '\t' })
  const sheet = book.Sheets[book.SheetNames[0]]
  return utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' })
    .filter((cells) => cells.some((cell) => cell !== '')).map(toUser)
}

export async function readUserFile(file: File): Promise<BulkUser[]> {
  if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error('CSV または .xlsx ファイルを選択してください。')
  const csv = /\.csv$/i.test(file.name)
  const book = read(csv ? await file.text() : await file.arrayBuffer(), { type: csv ? 'string' : 'array', raw: true, ...(csv ? { FS: ',' } : {}) })
  const sheet = book.Sheets[book.SheetNames[0]]
  if (!sheet) throw new Error('先頭シートがありません。')
  return importUsers(utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' }))
}

export function validateUsers(rows: BulkUser[]): BulkUser[] {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.userid.trim(), (counts.get(row.userid.trim()) ?? 0) + 1)
  return rows.map((row) => {
    if (row.created) return row
    const normalized = { ...row, userid: row.userid.trim(), role: row.role.trim().toLowerCase(), password: row.password || generatePassword() }
    const errors: string[] = []
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/.test(normalized.userid)) errors.push('userid は英数字で始まる1〜30文字の英数字・._-にしてください。')
    if ((counts.get(normalized.userid) ?? 0) > 1) errors.push('userid が一覧内で重複しています。')
    if ([...row.username].length < 1 || [...row.username].length > 64 || /\p{Cc}/u.test(row.username) || !/[^\p{Z}]/u.test(row.username)) errors.push('username は空白のみ・制御文字を除く1〜64文字にしてください。')
    if (normalized.role !== 'student' && normalized.role !== 'manager') errors.push('role は student または manager にしてください。')
    if ([...normalized.password].length < 8 || [...normalized.password].length > 256) errors.push('password は8〜256文字にしてください。')
    return { ...normalized, error: errors.join(' ') || undefined }
  })
}

export function usersCSV(rows: BulkUser[]): string {
  const escape = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
  return [userColumns.join(','), ...rows.map((row) => row.created ? userColumns.map((column) => escape(row[column])).join(',') : ',,,')].join('\r\n') + '\r\n'
}
