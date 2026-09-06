import { waitForDeployment } from './readiness.js'
import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { browserBaseURL } from '../environment.js'

test.setTimeout(270_000)
test.beforeAll(waitForDeployment)
const systemID = '00000000-0000-0000-0000-000000000097' // SeedDevelopment fixture
const uniqueUserid = () => `u-${randomUUID().slice(0, 20)}`
const valid = () => ({ userid: uniqueUserid(), name: '山田 🔑', role: 'student', password: 'initial-password' })
async function cookie(request: APIRequestContext, userid = 'admin', password = 'admin') {
  const response = await request.post('/api/session', { data: { userid, password } })
  expect(response.status()).toBe(200)
  return { Cookie: response.headers()['set-cookie'].split(';')[0] }
}
async function error(response: APIResponse, status: number, code: string) {
  expect(response.status()).toBe(status)
  expect(response.headers()['cache-control']).toBe('no-store')
  if (code === 'unauthorized') expect(response.headers()['set-cookie']).toContain('Max-Age=0')
  expect(await response.json()).toMatchObject({ error: { code } })
}

test('every Admin user endpoint requires authentication and Admin Role, before validation', async ({ request }) => {
  for (const role of [null, 'student', 'manager']) {
    const headers = role ? await cookie(request, role) : { Cookie: '' }
    for (const response of [
      await request.get('/api/admin/users', { headers }),
      await request.post('/api/admin/users', { headers, data: valid() }),
      await request.patch(`/api/admin/users/${systemID}`, { headers, data: { name: 'changed' } }),
      await request.post('/api/admin/users', { headers, data: {} }),
      await request.patch(`/api/admin/users/${systemID}`, { headers, data: {} }),
      await request.patch('/api/admin/users/not-a-uuid', { headers, data: { name: 'changed' } }),
      await request.patch('/api/admin/users/not-a-uuid', { headers: { ...headers, 'Content-Type': 'application/json' }, data: '{' }),
    ]) await error(response, role ? 403 : 401, role ? 'forbidden' : 'unauthorized')
  }
})

test('creation appends, excludes the System Account, and validates immutable case-sensitive Userids and Unicode inputs', async ({ request }) => {
  const headers = await cookie(request)
  await error(await request.patch('/api/admin/users/not-a-uuid', { headers, data: { name: 'changed' } }), 422, 'validation_failed')
  await error(await request.post('/api/admin/users', { data: '{', headers: { ...headers, 'Content-Type': 'application/json' } }), 422, 'validation_failed')
  const before = (await (await request.get('/api/admin/users', { headers })).json()).users
  expect(before.some((u: { id: string }) => u.id === systemID)).toBe(false)
  expect(before.find((u: { userid: string }) => u.userid === 'disabled')).toMatchObject({ disabled: true })
  const data = { ...valid(), name: ' 🔑'.repeat(32), password: '🔑'.repeat(256) }
  const created = await request.post('/api/admin/users', { headers, data })
  expect(created.status()).toBe(201)
  const user = await created.json()
  expect(user).toEqual({ id: expect.any(String), userid: data.userid, name: data.name, role: 'student', disabled: false })
  const after = (await (await request.get('/api/admin/users', { headers })).json()).users
  expect(after).toEqual([...before, user])
  await cookie(request, data.userid, data.password)
  await error(await request.post('/api/admin/users', { headers, data }), 409, 'userid_taken')
  expect((await request.post('/api/admin/users', { headers, data: { ...data, userid: data.userid.toUpperCase() } })).status()).toBe(201)
  for (const invalid of [
    { userid: '' }, { userid: 'a'.repeat(31) }, { userid: ' leading' }, { userid: '_leading' }, { userid: 'trailing\n' }, { userid: '日本語' },
    { name: '' }, { name: '🔑'.repeat(65) }, { name: ' \t\u3000' }, { name: 'a\u0085b' }, { name: 'a\nb' },
    { password: '🔑'.repeat(7) }, { password: '🔑'.repeat(257) }, { role: 'system' }, { confirmation: 'extra' },
  ]) await error(await request.post('/api/admin/users', { headers, data: { ...valid(), ...invalid } }), 422, 'validation_failed')
  for (const patch of [{}, { userid: 'replacement' }, { password: '' }, { name: null }, { disabled: null }, { name: '\u3000' }, { role: 'invalid' }]) {
    await error(await request.patch(`/api/admin/users/${user.id}`, { headers, data: patch }), 422, 'validation_failed')
  }
  await error(await request.patch(`/api/admin/users/${randomUUID()}`, { headers, data: { name: 'Unknown' } }), 404, 'not_found')
})

test('Admin cannot be created or assigned, and rejected promotion is atomic', async ({ request }) => {
  const headers = await cookie(request)
  const rejected = { ...valid(), role: 'admin' }
  await error(await request.post('/api/admin/users', { headers, data: rejected }), 422, 'validation_failed')
  for (const role of ['student', 'manager']) {
    const data = { ...valid(), role }
    const created = await request.post('/api/admin/users', { headers, data })
    expect(created.status()).toBe(201)
    const user = await created.json()
    await error(await request.patch(`/api/admin/users/${user.id}`, {
      headers, data: { role: 'admin', name: 'Must not persist', password: 'must-not-persist', disabled: true },
    }), 422, 'validation_failed')
    const session = await cookie(request, data.userid, data.password)
    expect(await (await request.get('/api/me', { headers: session })).json()).toMatchObject({ role, name: data.name })
    expect(await (await request.patch(`/api/admin/users/${user.id}`, {
      headers, data: { role: role === 'student' ? 'manager' : 'student' },
    })).json()).toMatchObject({ role: role === 'student' ? 'manager' : 'student' })
  }
  const users = (await (await request.get('/api/admin/users', { headers })).json()).users
  expect(users.filter((user: { role: string }) => user.role === 'admin')).toHaveLength(1)
  expect(users.some((user: { userid: string }) => user.userid === rejected.userid)).toBe(false)
})

test('partial updates preserve order, disable/reset revoke all sessions, and re-enable preserves password', async ({ request }) => {
  const headers = await cookie(request)
  const data = valid()
  const user = await (await request.post('/api/admin/users', { headers, data })).json()
  const path = `/api/admin/users/${user.id}`
  const listIDs = async () => (await (await request.get('/api/admin/users', { headers })).json()).users.map((u: { id: string }) => u.id)
  const order = await listIDs()
  const sessions = [await cookie(request, data.userid, data.password), await cookie(request, data.userid, data.password)]
  expect((await request.patch(path, { headers, data: { name: 'Edited', role: 'manager' } })).status()).toBe(200)
  for (const session of sessions) expect(await (await request.get('/api/me', { headers: session })).json()).toMatchObject({ name: 'Edited', role: 'manager' })
  for (let i = 0; i < 2; i++) expect(await (await request.patch(path, { headers, data: { disabled: true } })).json()).toMatchObject({ disabled: true })
  for (const session of sessions) expect((await request.get('/api/me', { headers: session })).status()).toBe(401)
  await error(await request.post('/api/session', { data: { userid: data.userid, password: data.password } }), 401, 'invalid_credentials')
  expect(await (await request.patch(path, { headers, data: { disabled: false } })).json()).toMatchObject({ disabled: false, name: 'Edited', role: 'manager' })
  for (const session of sessions) expect((await request.get('/api/me', { headers: session })).status()).toBe(401)
  const newSessions = [await cookie(request, data.userid, data.password), await cookie(request, data.userid, data.password)]
  expect((await request.patch(path, { headers, data: { password: ' new 🔑 password ' } })).status()).toBe(200)
  for (const session of newSessions) expect((await request.get('/api/me', { headers: session })).status()).toBe(401)
  await error(await request.post('/api/session', { data: { userid: data.userid, password: data.password } }), 401, 'invalid_credentials')
  await cookie(request, data.userid, ' new 🔑 password ')
  expect(await listIDs()).toEqual(order)
  expect((await request.patch(path, { headers, data: { disabled: true } })).status()).toBe(200)
  expect((await request.patch(path, { headers, data: { disabled: false, password: 'replacement-password' } })).status()).toBe(200)
  await cookie(request, data.userid, 'replacement-password')
})

test('System Account and self-protection conflicts are atomic', async ({ request }) => {
  const headers = await cookie(request)
  const own = headers
  const user = await (await request.get('/api/me', { headers })).json()
  for (const patch of [{ role: 'student', name: 'Must not persist' }, { role: 'manager' }, { disabled: true }]) {
    await error(await request.patch(`/api/admin/users/${user.id}`, { headers: own, data: patch }), 409, 'cannot_modify_self')
  }
  expect(await (await request.get('/api/me', { headers: own })).json()).toMatchObject({ name: user.name, role: 'admin' })
  expect((await request.patch(`/api/admin/users/${user.id}`, { headers: own, data: { name: user.name } })).status()).toBe(200)
  await error(await request.patch(`/api/admin/users/${systemID}`, { headers, data: { name: 'Changed', password: 'replacement-password', disabled: false } }), 409, 'cannot_modify_system_account')

})

test('browser Admin creates, filters, edits, confirms disable, and re-enables User Accounts', async ({ page }) => {
  await page.goto(new URL('/login', browserBaseURL).href)
  await page.getByLabel('User ID', { exact: true }).fill('admin')
  await page.getByLabel('Password', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByRole('link', { name: 'Manage users' }).click()
  await expect(page).toHaveURL(/\/admin\/users$/)
  const adminRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'admin', exact: true }) })
  await adminRow.getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByRole('dialog')).toContainText('Role: Admin')
  await expect(page.getByRole('dialog').getByRole('combobox')).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Create user' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('option')).toHaveText(['Student', 'Manager'])
  const userid = uniqueUserid()
  await dialog.getByLabel('User ID', { exact: true }).fill(userid)
  await dialog.getByLabel('Display name').fill('Browser User')
  await dialog.getByLabel('Password', { exact: true }).fill('browser-password')
  await dialog.getByLabel('Confirm password').fill('mismatch')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog.getByText('Passwords do not match.')).toBeVisible()
  await dialog.getByLabel('Confirm password').fill('browser-password')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('status')).toContainText('created')
  await page.getByLabel('Search users').fill(` ${userid.toUpperCase()} `)
  const row = page.getByRole('row').filter({ hasText: userid })
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: 'Edit' }).click()
  await expect(dialog.getByLabel('User ID', { exact: true })).toBeDisabled()
  await dialog.getByLabel('Display name').fill('Renamed Browser User')
  await expect(dialog.getByRole('option')).toHaveText(['Student', 'Manager'])
  await dialog.getByLabel('Role').selectOption('manager')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(row).toContainText('Renamed Browser User')
  await page.getByLabel('Search users').fill(' renamed browser ')
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Disable account' }).click()
  await expect(dialog).toContainText(userid)
  await expect(dialog).toContainText('Renamed Browser User')
  await expect(dialog).toContainText('sessions')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(row.getByRole('button', { name: 'Disable account' })).toBeVisible()
  await row.getByRole('button', { name: 'Disable account' }).click()
  await dialog.getByRole('button', { name: 'Disable account' }).click()
  await expect(row.getByRole('button', { name: 'Re-enable' })).toBeVisible()
  await page.getByLabel('State').selectOption('active')
  await expect(row).toHaveCount(0)
  await page.getByLabel('State').selectOption('disabled')
  await row.getByRole('button', { name: 'Re-enable' }).click()
  await expect(row).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByLabel('State').selectOption('all')
  await expect(row.getByRole('button', { name: 'Disable account' })).toBeVisible()
})

for (const role of ['student', 'manager']) {
  test(`browser ${role} has no Admin link and renders 403 on direct navigation`, async ({ page }) => {
    await page.goto(new URL('/login', browserBaseURL).href)
    await page.getByLabel('User ID', { exact: true }).fill(role)
    await page.getByLabel('Password', { exact: true }).fill('admin')
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page).toHaveURL(new URL('/', browserBaseURL).href)
    await expect(page.getByRole('link', { name: 'Manage users' })).toHaveCount(0)
    await page.goto(new URL('/admin/users', browserBaseURL).href)
    await expect(page.getByRole('heading', { name: '403 Forbidden' })).toBeVisible()
  })
}

test('global order is Admin-only, requires every non-System ID once and preserves order on mismatch', async ({ request }) => {
  for (const role of [null, 'student', 'manager']) {
    const headers = role ? await cookie(request, role) : { Cookie: '' }
    await error(await request.patch('/api/users/order', { headers, data: { user_ids: [] } }), role ? 403 : 401, role ? 'forbidden' : 'unauthorized')
  }
  const headers = await cookie(request)
  const list = async (): Promise<string[]> => (await (await request.get('/api/admin/users', { headers })).json()).users.map((u: { id: string }) => u.id)
  const original = await list()
  const reversed = [...original].reverse()
  expect((await request.patch('/api/users/order', { headers, data: { user_ids: reversed } })).status()).toBe(204)
  expect(await list()).toEqual(reversed)
  for (const ids of [[], reversed.slice(1), [...reversed, reversed[0]], [...reversed, systemID], [...reversed.slice(1), randomUUID()]]) {
    await error(await request.patch('/api/users/order', { headers, data: { user_ids: ids } }), 422, 'user_ids_mismatch')
    expect(await list()).toEqual(reversed)
  }
  const newUser = await (await request.post('/api/admin/users', { headers, data: valid() })).json()
  expect(await list()).toEqual([...reversed, newUser.id])
  await error(await request.patch('/api/users/order', { headers, data: { user_ids: reversed } }), 422, 'user_ids_mismatch')
})

test('browser bulk import retries failed rows and manual ordering saves or cancels globally', async ({ page, request }) => {
  await page.goto(new URL('/login', browserBaseURL).href)
  await page.getByLabel('User ID', { exact: true }).fill('admin')
  await page.getByLabel('Password', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByRole('link', { name: 'Manage users' }).click()
  await page.getByRole('link', { name: '一括作成' }).click()
  const first = uniqueUserid()
  const second = uniqueUserid()
  await page.getByLabel('CSV / Excel ファイル').setInputFiles({
    name: 'users.csv', mimeType: 'text/csv',
    buffer: Buffer.from(`userid,username,role,password\n${first},一括作成1,student,\nadmin,一括作成2,manager,manual-password\n`),
  })
  const password = await page.getByLabel('1行目 password').inputValue()
  expect(password).toMatch(/^[a-zA-Z0-9]{6}-[a-zA-Z0-9]{6}-[a-zA-Z0-9]{6}$/)
  const firstDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  const download = await firstDownload
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream!) chunks.push(chunk)
  expect(Buffer.concat(chunks).toString('utf8')).toContain(`${first},一括作成1,student,${password}\r\n,,,\r\n`)
  await expect(page.getByLabel('1行目 userid')).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('already taken')
  await page.getByLabel('2行目 userid').fill(second)
  const retryDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  const retryStream = await (await retryDownload).createReadStream()
  const retryChunks = []
  for await (const chunk of retryStream!) retryChunks.push(chunk)
  expect(Buffer.concat(retryChunks).toString('utf8')).toContain(`${first},一括作成1,student,${password}\r\n${second},一括作成2,manager,manual-password\r\n`)
  await cookie(request, first, password)
  await cookie(request, second, 'manual-password')
  await page.getByRole('link', { name: 'User Accounts', exact: true }).click()
  await page.getByRole('button', { name: '戻る', exact: true }).click()
  await expect(page.getByLabel('1行目 password')).toHaveValue(password)
  await page.getByRole('link', { name: 'User Accounts', exact: true }).click()
  await page.getByRole('button', { name: '離れる', exact: true }).click()
  await page.getByLabel('Search users').fill(first)
  await page.getByLabel('State', { exact: true }).selectOption('active')
  await page.getByRole('button', { name: '並び順を編集' }).click()
  await expect(page.getByLabel('Search users')).toHaveCount(0)
  const rows = page.getByRole('row')
  const original = await rows.allTextContents()
  await page.getByRole('button', { name: `${second} を上へ`, exact: true }).click()
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await page.getByRole('button', { name: '並び順を編集' }).click()
  expect(await rows.allTextContents()).toEqual(original)
  await page.getByRole('button', { name: `${second} を上へ`, exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('並び順を保存しました')
  await page.reload()
  const headers = await cookie(request)
  const users = (await (await request.get('/api/admin/users', { headers })).json()).users
  expect(users.slice(-2).map((user: { userid: string }) => user.userid)).toEqual([second, first])
  // A newly created account makes the editor's snapshot incomplete.
  await page.getByRole('button', { name: '並び順を編集' }).click()
  expect((await request.post('/api/admin/users', { headers, data: valid() })).status()).toBe(201)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('ユーザー構成が変わりました')
  await expect(page.getByRole('button', { name: '並び順を編集' })).toBeVisible()
})
