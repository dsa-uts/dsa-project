import { expect, test } from '@playwright/test'

// scripts/e2e-outage.sh runs this on the host after stopping PostgreSQL in the
// isolated test namespace. Assertions still use only the public HTTP interface.
test('authentication backend outage returns 500 before input validation', async ({ request }) => {
  test.skip(process.env.E2E_AUTH_OUTAGE !== '1', 'Requires the isolated datastore outage phase')
  const headers = { Cookie: '__Host-dsa_session=outage-test-token' }
  for (const response of [
    await request.get('/api/me', { headers }),
    await request.get('/api/admin/users', { headers }),
    await request.post('/api/admin/users', { headers, data: {} }),
    await request.patch('/api/admin/users/not-a-uuid', { headers, data: {} }),
  ]) {
    expect(response.status()).toBe(500)
    expect(await response.json()).toEqual({
      error: { code: 'internal_server_error', message: 'Internal server error.' },
    })
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(response.headers()['set-cookie']).toBeUndefined()
  }
  // These public operations and a missing-cookie rejection do not need the DB.
  expect((await request.delete('/api/session', { headers: { Cookie: '' } })).status()).toBe(204)
  expect((await request.post('/api/session', { data: {} })).status()).toBe(422)
  expect((await request.get('/api/me', { headers: { Cookie: '' } })).status()).toBe(401)
})
