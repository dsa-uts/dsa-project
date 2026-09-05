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
    ]) await error(response, role ? 403 : 401, role ? 'forbidden' : 'unauthorized')
  }
})

test('creation appends, excludes the System Account, and validates immutable case-sensitive Userids and Unicode inputs', async ({ request }) => {
  const headers = await cookie(request)
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
