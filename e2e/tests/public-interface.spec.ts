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
