import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiBaseURL, browserBaseURL } from '../environment.js'

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

test.beforeAll(async () => {
  await expect(async () => {
    const [frontendResponse, healthResponse] = await Promise.all([
      fetch(new URL('/', apiBaseURL)),
      fetch(new URL('/health', apiBaseURL)),
    ])
    expect(frontendResponse.status).toBe(200)
    expect(healthResponse.status).toBe(200)
  }).toPass({ timeout: 240_000 })
})

test('the browser logs in, shows the User Account, logs out, and guards routes', async ({ page }) => {
  await page.goto(new URL('/unknown', browserBaseURL).href)
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('User ID').fill('admin')
  await page.getByLabel('Password').fill('admin')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(new URL('/', browserBaseURL).href)
  await expect(page.getByText('Development Admin')).toBeVisible()
  await expect(page.getByText('admin', { exact: true })).toBeVisible()

  await page.goto(new URL('/unknown', browserBaseURL).href)
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
  await page.goto(new URL('/login', browserBaseURL).href)
  await expect(page).toHaveURL(new URL('/', browserBaseURL).href)
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('login validates input and makes authentication failures indistinguishable', async ({ request }) => {
  const missing = await request.post('/api/session', { data: { password: 'admin' } })
  expect(missing.status()).toBe(422)
  await expect(missing.json()).resolves.toMatchObject({ error: { code: 'validation_failed' } })

  const attempts = [
    { userid: 'missing', password: 'admin' },
    { userid: 'admin', password: 'wrong' },
    { userid: 'disabled', password: 'admin' },
    { userid: 'system', password: 'admin' },
  ]
  const bodies = []
  for (const data of attempts) {
    const response = await request.post('/api/session', { data })
    expect(response.status()).toBe(401)
    expect(response.headers()['cache-control']).toBe('no-store')
    bodies.push(await response.json())
  }
  expect(bodies).toEqual(attempts.map(() => ({ error: { code: 'invalid_credentials', message: 'Invalid userid or password.' } })))
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

test('re-login replaces only the presented session and logout is isolated and idempotent', async ({ request }) => {
  const first = sessionCookie(await login(request)).token
  const independent = sessionCookie(await login(request)).token
  const replacement = sessionCookie(await login(request, first)).token
  expect((await request.get('/api/me', { headers: { Cookie: `__Host-dsa_session=${first}` } })).status()).toBe(401)
  expect((await request.get('/api/me', { headers: { Cookie: `__Host-dsa_session=${independent}` } })).status()).toBe(200)
  expect((await request.get('/api/me', { headers: { Cookie: `__Host-dsa_session=${replacement}` } })).status()).toBe(200)

  const logout = await request.delete('/api/session', { headers: { Cookie: `__Host-dsa_session=${replacement}` } })
  expect(logout.status()).toBe(204)
  expect(logout.headers()['set-cookie']).toContain('Max-Age=0')
  expect((await request.delete('/api/session')).status()).toBe(204)
  expect((await request.get('/api/me', { headers: { Cookie: `__Host-dsa_session=${independent}` } })).status()).toBe(200)
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
