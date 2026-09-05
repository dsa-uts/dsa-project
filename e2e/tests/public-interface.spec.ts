import { waitForDeployment } from './readiness.js'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { browserBaseURL } from '../environment.js'

test.setTimeout(270_000)
const expiredToken = 'expired-development-session'

function sessionCookie(response: APIResponse) {
  const header = response.headers()['set-cookie']
  const match = header?.match(/__Host-dsa_session=([^;]*)/)
  expect(match).toBeTruthy()
  return { header, token: match![1] }
}

async function login(request: APIRequestContext, cookie?: string) {
  return request.post('/api/session', {
    data: { userid: 'admin', password: 'admin' },
    headers: { Cookie: cookie ? `__Host-dsa_session=${cookie}` : '' },
  })
}

test.beforeAll(waitForDeployment)

test('the browser logs in, shows the User Account, logs out, and guards routes', async ({ page }) => {
  await page.goto(new URL('/unknown', browserBaseURL).href)
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('banner')).toHaveCount(0)
  await page.getByLabel('User ID').fill('admin')
  await page.getByLabel('Password').fill('admin')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(new URL('/', browserBaseURL).href)
  await expect(page.getByText('Development Admin')).toBeVisible()
  await expect(page.getByText('admin', { exact: true })).toBeVisible()

  await page.goto(new URL('/unknown', browserBaseURL).href)
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
  await page.getByRole('banner').getByRole('link', { name: 'DSA', exact: true }).click()
  await expect(page).toHaveURL(new URL('/', browserBaseURL).href)
  await page.goto(new URL('/login', browserBaseURL).href)
  await expect(page).toHaveURL(new URL('/', browserBaseURL).href)
  await page.getByRole('banner').getByRole('button', { name: 'Logout' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('login validates input and makes authentication failures indistinguishable', async ({ request }) => {
  const activeToken = sessionCookie(await login(request)).token
  const presentedSession = { Cookie: `__Host-dsa_session=${activeToken}` }
  const invalidInputs = [
    { password: 'admin' },
    { userid: 'u'.repeat(31), password: 'admin' },
    { userid: 'admin', password: 'p'.repeat(257) },
  ]
  for (const data of invalidInputs) {
    const response = await request.post('/api/session', { data, headers: presentedSession })
    expect(response.status()).toBe(422)
    expect(response.headers()['cache-control']).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'validation_failed' } })
  }

  const attempts = [
    { userid: 'u'.repeat(30), password: 'admin' },
    { userid: 'admin', password: 'p'.repeat(256) },
    { userid: 'missing', password: 'admin' },
    { userid: 'admin', password: 'wrong' },
    { userid: 'disabled', password: 'admin' },
    { userid: 'system', password: 'admin' },
  ]
  const bodies = []
  for (const data of attempts) {
    const response = await request.post('/api/session', { data, headers: presentedSession })
    expect(response.status()).toBe(401)
    expect(response.headers()['cache-control']).toBe('no-store')
    bodies.push(await response.json())
  }
  expect(bodies).toEqual(attempts.map(() => ({ error: { code: 'invalid_credentials', message: 'Invalid userid or password.' } })))
  expect((await request.get('/api/me', { headers: presentedSession })).status()).toBe(200)
})

test('login sets the seven-day host cookie and /api/me returns the current User Account', async ({ request }) => {
  const response = await login(request)
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  const { header, token } = sessionCookie(response)
  expect(header).toContain('Path=/')
  expect(header).toContain('Max-Age=604800')
  expect(header).toContain('HttpOnly')
  expect(header).toContain('Secure')
  expect(header).toContain('SameSite=Lax')
  expect(header).not.toContain('Domain=')
  const me = await request.get('/api/me', { headers: { Cookie: `__Host-dsa_session=${token}` } })
  expect(me.status()).toBe(200)
  await expect(me.json()).resolves.toMatchObject({ userid: 'admin', name: 'Development Admin', role: 'admin' })
})

test('login ignores a presented session and logout is isolated and idempotent', async ({ request }) => {
  const first = sessionCookie(await login(request)).token
  const independent = sessionCookie(await login(request)).token
  const latest = sessionCookie(await login(request, first)).token
  expect((await request.get('/api/me', { headers: { Cookie: `__Host-dsa_session=${first}` } })).status()).toBe(200)
  expect((await request.get('/api/me', { headers: { Cookie: `__Host-dsa_session=${independent}` } })).status()).toBe(200)
  expect((await request.get('/api/me', { headers: { Cookie: `__Host-dsa_session=${latest}` } })).status()).toBe(200)

  const logout = await request.delete('/api/session', { headers: { Cookie: `__Host-dsa_session=${latest}` } })
  expect(logout.status()).toBe(204)
  expect(logout.headers()['set-cookie']).toContain('Max-Age=0')
  expect((await request.delete('/api/session')).status()).toBe(204)
  expect((await request.get('/api/me', { headers: { Cookie: `__Host-dsa_session=${independent}` } })).status()).toBe(200)
})

test('a User Account retains only its five latest sequential sessions', async ({ request }) => {
  const tokens = []
  for (let attempt = 0; attempt < 6; attempt += 1) {
    tokens.push(sessionCookie(await login(request)).token)
  }

  const responses = await Promise.all(tokens.map(token =>
    request.get('/api/me', { headers: { Cookie: `__Host-dsa_session=${token}` } }),
  ))
  expect(responses.map(response => response.status())).toEqual([401, 200, 200, 200, 200, 200])
  expect(responses[0].headers()['set-cookie']).toContain('Max-Age=0')
  await expect(responses[0].json()).resolves.toEqual({
    error: { code: 'unauthorized', message: 'Authentication is required.' },
  })
})

test('parallel logins for one User Account leave exactly five valid sessions', async ({ request }) => {
  const tokens = await Promise.all(Array.from({ length: 6 }, async () =>
    sessionCookie(await login(request)).token,
  ))
  const statuses = await Promise.all(tokens.map(async token =>
    (await request.get('/api/me', { headers: { Cookie: `__Host-dsa_session=${token}` } })).status(),
  ))
  expect(statuses.filter(status => status === 200)).toHaveLength(5)
  expect(statuses.filter(status => status === 401)).toHaveLength(1)
})

test('an expired browser session is cleared and redirected to login', async ({ context, page }) => {
  await context.addCookies([{
    name: '__Host-dsa_session',
    value: expiredToken,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  }])
  await page.goto(new URL('/', browserBaseURL).href)
  await expect(page).toHaveURL(/\/login$/)
  expect((await context.cookies()).some(({ name }) => name === '__Host-dsa_session')).toBe(false)
})

test('invalid and expired sessions are rejected and cleared', async ({ request }) => {
  for (const token of ['invalid-session', expiredToken]) {
    const response = await request.get('/api/me', { headers: { Cookie: `__Host-dsa_session=${token}` } })
    expect(response.status()).toBe(401)
    expect(response.headers()['set-cookie']).toContain('Max-Age=0')
  }
  const expiredAgain = await request.get('/api/me', { headers: { Cookie: `__Host-dsa_session=${expiredToken}` } })
  expect(expiredAgain.status()).toBe(401)
})

test('health and the generic API error envelope remain available', async ({ request }) => {
  expect((await request.get('/health')).status()).toBe(200)
  const response = await request.get('/api/unknown')
  expect(response.status()).toBe(404)
  await expect(response.json()).resolves.toMatchObject({ error: { code: 'not_found', message: expect.any(String) } })
})
