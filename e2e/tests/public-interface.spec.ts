import { expect, test } from '@playwright/test'
import { baseURL } from '../environment.js'

test.setTimeout(270_000)

test.beforeAll(async () => {
  await expect(async () => {
    const [frontendResponse, healthResponse] = await Promise.all([
      fetch(new URL('/', baseURL)),
      fetch(new URL('/health', baseURL)),
    ])
    expect(frontendResponse.status).toBe(200)
    expect(healthResponse.status).toBe(200)
  }).toPass({ timeout: 240_000 })
})

test('a user creates a greeting and sees it in the list', async ({ page }) => {
  const name = `e2e-${Date.now()}`

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Hello, DSA Project' })).toBeVisible()
  await expect(page.getByText('backend health:')).toContainText('ok')

  await page.getByRole('textbox', { name: 'name' }).fill(name)
  await page.getByRole('button', { name: 'Greet' }).click()

  await expect(page.getByRole('listitem').filter({ hasText: `hello, ${name}` })).toBeVisible()
})

test('the public API creates a persisted greeting', async ({ request }) => {
  const name = `api-create-${Date.now()}`
  const response = await request.post('/api/hello', { data: { name } })

  expect(response.status()).toBe(201)
  const greeting = (await response.json()) as { id: string; message: string; created_at: string }
  expect(greeting.message).toBe(`hello, ${name}`)
  expect(greeting.id).toEqual(expect.any(String))
  expect(greeting.id).not.toBe('')
  expect(greeting.created_at).toEqual(expect.any(String))
  expect(greeting.created_at).not.toBe('')
})

test('the public API lists greetings newest first', async ({ request }) => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const olderName = `api-order-older-${run}`
  const newerName = `api-order-newer-${run}`

  expect((await request.post('/api/hello', { data: { name: olderName } })).status()).toBe(201)
  expect((await request.post('/api/hello', { data: { name: newerName } })).status()).toBe(201)

  const response = await request.get('/api/hello')
  expect(response.status()).toBe(200)

  const body = (await response.json()) as { greetings: Array<{ message: string }> }
  const greetings = body.greetings
  const messages = greetings.map(({ message }) => message)
  const olderIndex = messages.indexOf(`hello, ${olderName}`)
  const newerIndex = messages.indexOf(`hello, ${newerName}`)

  expect(olderIndex).toBeGreaterThanOrEqual(0)
  expect(newerIndex).toBeGreaterThanOrEqual(0)
  expect(newerIndex).toBeLessThan(olderIndex)
})

test('invalid public API input uses the OpenAPI error envelope', async ({ request }) => {
  const response = await request.post('/api/hello', { data: { name: '' } })

  expect(response.status()).toBe(422)
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: 'validation_failed',
      message: expect.any(String),
    },
  })
})

test('missing public API input uses the OpenAPI error envelope', async ({ request }) => {
  const response = await request.post('/api/hello', { data: {} })

  expect(response.status()).toBe(422)
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: 'validation_failed',
      message: expect.any(String),
    },
  })
})

test('an unknown public API route uses the OpenAPI error envelope', async ({ request }) => {
  const response = await request.get('/api/unknown')

  expect(response.status()).toBe(404)
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: 'not_found',
      message: expect.any(String),
    },
  })
})
