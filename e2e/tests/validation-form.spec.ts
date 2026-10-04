import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { components } from '../../frontend/src/api/schema.js'

test('submit files through the form, navigate to Results, and filter persisted Requests', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/login')
  await page.getByLabel('User ID', { exact: true }).fill('admin')
  await page.getByLabel('Password', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  const imported = await page.request.post('/api/admin/resource-imports', { data: { resource_id: 'ex1', version: 'v1.0.0' } })
  expect(imported.status(), await imported.text()).toBe(200)
  const { project_id } = await imported.json()
  await page.goto(`/projects/${project_id}`)
  const source = `// ${randomUUID()}\nint main(void) { return 0; }\n`
  await page.getByLabel('提出ファイル', { exact: true }).setInputFiles([
    { name: 'main.c', mimeType: 'text/plain', buffer: Buffer.from(source) },
    { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) },
  ])
  await expect(page.getByRole('list', { name: '選択したファイル' })).toContainText('empty.txt')
  const creation = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/projects/${project_id}/validation`))
  await page.getByRole('button', { name: '提出する', exact: true }).click()
  const response = await creation
  expect(response.status(), await response.text()).toBe(201)
  const created: components['schemas']['CreatedRequest'] = await response.json()
  await expect(page).toHaveURL(/\/results$/)
  await expect(page.getByRole('heading', { level: 1, name: 'All', exact: true })).toBeVisible()
  const row = page.getByRole('row').filter({ has: page.locator(`[title="${created.id}"]`) })
  await expect(row).toBeVisible()
  await expect(row).toContainText('v1.0.0')

  // Inspect through the public API to ensure the browser's multipart kept the bytes and paths.
  const files = await page.request.get(`/api/requests/${created.id}/validation/files`)
  expect(files.status()).toBe(200)
  const form = await new Response(new Uint8Array(await files.body()), { headers: { 'Content-Type': files.headers()['content-type'] } }).formData()
  const metadata: components['schemas']['ValidationFilesMetadata'] = JSON.parse(String(form.get('metadata')))
  expect(metadata.submission_files.map(file => file.path).sort()).toEqual(['empty.txt', 'main.c'])
  const main = metadata.submission_files.find(file => file.path === 'main.c')!
  expect(await (form.get(main.part) as File).text()).toBe(source)

  await page.setViewportSize({ width: 1584, height: 992 })
  await page.screenshot({ path: 'test-results/validation-results.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/validation-results-mobile.png', fullPage: true })
  await page.getByRole('navigation', { name: '結果の課題絞り込み' }).locator(`a[href*="project_id=${project_id}"]`).click()
  await expect(page).toHaveURL(new RegExp(`project_id=${project_id}`))
  await page.getByLabel('全体結果').selectOption('AC')
  await expect(page).toHaveURL(/status=AC/)
  await page.reload()
  await expect(page.getByLabel('全体結果')).toHaveValue('AC')
  await page.getByLabel('全体結果').selectOption('')
  await expect(row).toBeVisible()
})
