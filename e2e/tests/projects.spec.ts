import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'

test('Dashboard lists actual Projects and filters them without navigation', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/login')
  await page.getByLabel('User ID', { exact: true }).fill('admin')
  await page.getByLabel('Password', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  for (const resource_id of ['ex1', 'ex2']) {
    const response = await page.request.post('/api/admin/resource-imports', { data: { resource_id, version: 'v1.0.0' } })
    expect(response.status(), await response.text()).toBe(200)
  }
  const response = await page.request.get('/api/projects')
  expect(response.status()).toBe(200)
  const { projects } = await response.json()
  await page.getByRole('link', { name: 'Dashboard' }).click()
  await expect(page.getByRole('heading', { name: 'Problem List' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(projects.map((project: { name: string }) => project.name))
  await expect(page.getByText('実行結果なし', { exact: true })).toHaveCount(projects.length)
  await page.getByRole('tab', { name: projects[0].name, exact: true }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([projects[0].name])
  await expect(page.getByRole('tabpanel').getByRole('listitem')).toHaveText(projects[0].workflows.map((workflow: { name: string }) => workflow.name))
  await page.getByRole('tab', { name: 'All', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(projects.length)
  await page.setViewportSize({ width: 1584, height: 992 })
  await page.screenshot({ path: 'test-results/problem-list.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/problem-list-mobile.png', fullPage: true })
})

async function cookie(request: APIRequestContext, role = 'admin') {
  const response = await request.post('/api/session', { data: { userid: role, password: 'admin' } })
  expect(response.status()).toBe(200)
  return { Cookie: response.headers()['set-cookie'].split(';')[0] }
}
async function error(response: APIResponse, status: number, code: string) {
  expect(response.status()).toBe(status)
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(await response.json()).toMatchObject({ error: { code } })
}

test('Project authorization precedes input validation', async ({ request }) => {
  for (const role of [null, 'student', 'manager']) {
    const headers = role ? await cookie(request, role) : { Cookie: '' }
    for (const response of [
      await request.patch('/api/admin/projects', { headers, data: {} }),
      await request.post('/api/admin/resource-imports', { headers, data: { version: 'invalid' } }),
    ]) await error(response, role ? 403 : 401, role ? 'forbidden' : 'unauthorized')
  }
  await error(await request.get('/api/projects', { headers: { Cookie: '' } }), 401, 'unauthorized')
  await error(await request.get('/api/projects/invalid?version_id=old', { headers: { Cookie: '' } }), 401, 'unauthorized')
})

test('real Resource import, idempotence, publication and atomic bulk saves', async ({ request }) => {
  test.setTimeout(120_000)
  const headers = await cookie(request)
  const student = await cookie(request, 'student')
  const manager = await cookie(request, 'manager')
  const list = async (auth = headers) => {
    const response = await request.get('/api/projects', { headers: auth })
    expect(response.status()).toBe(200)
    return (await response.json()).projects
  }
  const before = await list()
  if (!before.length) expect((await request.patch('/api/admin/projects', { headers, data: { projects: [] } })).status()).toBe(204)
  const data = { resource_id: 'ex1', version: 'v1.0.0' }
  const responses = await Promise.all([1, 2].map(() => request.post('/api/admin/resource-imports', { headers, data })))
  for (const response of responses) expect(response.status(), await response.text()).toBe(200)
  const imports = await Promise.all(responses.map(response => response.json()))
  const result = imports.find(item => item.changed) ?? imports[0]
  expect(imports[0].project_id).toBe(imports[1].project_id)
  expect(imports[0].version_id).toBe(imports[1].version_id)
  expect(imports.filter(item => item.changed)).toHaveLength(before.some((p: { resource_id: string }) => p.resource_id === 'ex1') ? 0 : 1)
  expect(result).toMatchObject({ ...data, project_id: expect.any(String), version_id: expect.any(String), changed: !before.some((p: { resource_id: string }) => p.resource_id === 'ex1') })
  const after = await list()
  const project = after.find((p: { id: string }) => p.id === result.project_id)
  const detailURL = `/api/projects/${result.project_id}`
  const detailResponse = await request.get(detailURL, { headers })
  expect(detailResponse.status()).toBe(200)
  const detail = await detailResponse.json()
  expect(detail).toMatchObject(project)
  expect(Object.keys(detail).sort()).toEqual([...Object.keys(project), 'required_files'].sort())
  expect(Array.isArray(detail.required_files)).toBe(true)
  expect(detail.workflows.map((w: { id: string }) => w.id)).toEqual(project.workflows.map((w: { id: string }) => w.id))
  for (const workflow of detail.workflows) {
    expect(Object.keys(workflow).sort()).toEqual(['description_markdown', 'id', 'name'])
    expect(workflow.description_markdown).toEqual(expect.any(String))
    expect(workflow.description_markdown.length).toBeGreaterThan(0)
  }
  await error(await request.get('/api/projects/invalid', { headers }), 422, 'validation_failed')
  await error(await request.get(`/api/projects/${randomUUID()}`, { headers }), 404, 'not_found')
  for (const query of ['?version_id=old', '?version_id=']) {
    await error(await request.get(detailURL + query, { headers }), 422, 'version_not_allowed')
  }
  expect(project).toMatchObject({ resource_id: 'ex1', latest_version_id: result.version_id, latest_version: 'v1.0.0', my_result: null })
  expect(Object.keys(project).sort()).toEqual(['id','resource_id','name','latest_version_id','latest_version','display_order','published_at','deadline','workflows','my_result'].sort())
  expect(project.workflows.length).toBeGreaterThan(0)
  for (const workflow of project.workflows) expect(Object.keys(workflow).sort()).toEqual(['id', 'name'])
  if (result.changed) {
    expect(after.at(-1).id).toBe(result.project_id)
    expect(project).toMatchObject({ published_at: null, deadline: null })
  }
  for (const response of await Promise.all([1,2].map(() => request.post('/api/admin/resource-imports', { headers, data })))) {
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ ...result, changed: false })
  }
  await error(await request.post('/api/admin/resource-imports', { headers, data: { ...data, version: 'v0.9.0' } }), 409, 'older_resource_version')
  for (const version of ['1.0.0','v1.0','v01.0.0','v1.0.0-rc.1','v1.0.0+build']) {
    await error(await request.post('/api/admin/resource-imports', { headers, data: { ...data, version } }), 422, 'invalid_resource_version')
  }
  await error(await request.post('/api/admin/resource-imports', { headers, data: { ...data, repository: 'https://evil.test' } }), 422, 'validation_failed')
  await error(await request.post('/api/admin/resource-imports', { headers, data: { resource_id: `missing-${randomUUID()}`, version: 'v1.0.0' } }), 404, 'resource_version_not_found')
  expect(await list()).toEqual(after)

  const original = after.map((p: { id: string; published_at: string | null; deadline: string | null }) => ({ id: p.id, published_at: p.published_at, deadline: p.deadline }))
  const save = (projects: unknown) => request.patch('/api/admin/projects', { headers, data: { projects } })
  try {
    const updates = original.toReversed().map((p: { id: string }) => ({ id: p.id, published_at: '2020-01-01T00:00:00Z', deadline: '2020-01-01T00:00:00Z' }))
    expect((await save(updates)).status()).toBe(204)
    const saved = await list()
    expect(saved.map((p: { id: string }) => p.id)).toEqual(updates.map((p: { id: string }) => p.id))
    expect((await list(student)).map((p: { id: string }) => p.id)).toEqual(updates.map((p: { id: string }) => p.id))
    const studentDetail = await request.get(detailURL, { headers: student })
    expect(studentDetail.status()).toBe(200)
    expect(await studentDetail.json()).toMatchObject({ id: result.project_id, workflows: detail.workflows, required_files: detail.required_files, my_result: null })
    for (const projects of [updates.slice(1), [...updates, updates[0]], [{ ...updates[0], id: randomUUID() }, ...updates.slice(1)]]) {
      await error(await save(projects), 422, 'project_ids_mismatch')
      expect(await list()).toEqual(saved)
    }
    for (const invalid of [
      { id: result.project_id, published_at: null },
      { ...updates[0], deadline: '1999-01-01T00:00:00Z' },
      { ...updates[0], published_at: 'invalid' },
      { ...updates[0], published_at: '2020-01-01T09:00:00+09:00' },
      { ...updates[0], name: 'Must not change' },
    ]) {
      await error(await save([invalid, ...updates.slice(1)]), 422, 'validation_failed')
      expect(await list()).toEqual(saved)
    }
    expect((await save(updates.map((p: { id: string }) => ({ ...p, published_at: null })))).status()).toBe(204)
    expect(await list(student)).toEqual([])
    expect(await list(manager)).toHaveLength(updates.length)
    await error(await request.get(detailURL, { headers: student }), 404, 'not_found')
    await error(await request.get(detailURL + '?version_id=old', { headers: student }), 404, 'not_found')
    expect((await request.get(detailURL, { headers: manager })).status()).toBe(200)
    expect((await save(updates.map((p: { id: string }) => ({ ...p, published_at: '2999-01-01T00:00:00Z', deadline: null })))).status()).toBe(204)
    expect(await list(student)).toEqual([])
    await error(await request.get(detailURL, { headers: student }), 404, 'not_found')
    expect((await request.get(detailURL, { headers })).status()).toBe(200)
    const scheduled = await list()
    expect((await request.post('/api/admin/resource-imports', { headers, data })).status()).toBe(200)
    expect(await list()).toEqual(scheduled)
  } finally {
    expect((await save(original)).status()).toBe(204)
  }
})

test('Admin imports two Projects and saves their order and JST schedules', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/login')
  await page.getByLabel('User ID', { exact: true }).fill('admin')
  await page.getByLabel('Password', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByRole('link', { name: 'Admin', exact: true }).click()
  await page.getByRole('link', { name: 'Project Management', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Project Management', exact: true })).toBeVisible()
  await page.getByLabel('リソースID', { exact: true }).fill('Invalid_ID')
  await page.getByLabel('バージョン', { exact: true }).fill('v1.0.0')
  expect(await page.getByLabel('リソースID', { exact: true }).evaluate((input: HTMLInputElement) => input.validity.patternMismatch)).toBe(true)
  for (const resourceId of ['ex1', 'ex2']) {
    await page.getByLabel('リソースID', { exact: true }).fill(resourceId)
    await page.getByLabel('バージョン', { exact: true }).fill('v1.0.0')
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /登録|保存/ })).toContainText(/登録しました|登録済み/, { timeout: 65_000 })
    await expect(page.getByRole('cell', { name: resourceId, exact: true })).toBeVisible()
  }
  const response = await page.request.get('/api/projects')
  expect(response.status()).toBe(200)
  const projects = (await response.json()).projects
  const original = projects.map((p: { id: string; published_at: string | null; deadline: string | null }) => ({ id: p.id, published_at: p.published_at, deadline: p.deadline }))
  const expectedOrder: string[] = projects.map((p: { resource_id: string }) => p.resource_id)
  ;[expectedOrder[0], expectedOrder[1]] = [expectedOrder[1], expectedOrder[0]]
  const resourceCells = page.locator('tbody tr td:nth-child(3)')
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'ex1', exact: true }) })
  try {
    const handles = page.getByRole('button', { name: /を移動$/ })
    const source = await handles.nth(0).boundingBox()
    const target = await handles.nth(1).boundingBox()
    expect(source).not.toBeNull()
    expect(target).not.toBeNull()
    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2)
    await page.mouse.down()
    await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 10 })
    await page.mouse.up()
    await expect(resourceCells).toHaveText(expectedOrder)
    await row.getByLabel(/の公開日時/).fill('2026-09-12T19:59')
    await row.getByLabel(/の締切日時/).fill('2026-09-19T19:59')
    await page.getByRole('button', { name: '変更を保存' }).click()
    await expect(page.getByRole('status').filter({ hasText: /登録|保存/ })).toHaveText('日時・表示順を保存しました。')
    await expect(page.getByRole('button', { name: '変更を保存' })).toBeDisabled()
    await page.reload()
    await expect(resourceCells).toHaveText(expectedOrder)
    await expect(row.getByLabel(/の公開日時/)).toHaveValue('2026-09-12T19:59')
    await expect(row.getByLabel(/の締切日時/)).toHaveValue('2026-09-19T19:59')
    const saved = (await (await page.request.get('/api/projects')).json()).projects.find((p: { resource_id: string }) => p.resource_id === 'ex1')
    expect(saved).toMatchObject({ published_at: '2026-09-12T10:59:00Z', deadline: '2026-09-19T10:59:00Z' })
    await row.getByLabel(/の公開日時/).fill('')
    await row.getByLabel(/の締切日時/).fill('')
    await page.getByRole('button', { name: '変更を保存' }).click()
    await expect(page.getByRole('status').filter({ hasText: /登録|保存/ })).toHaveText('日時・表示順を保存しました。')
    await expect(page.getByRole('button', { name: '変更を保存' })).toBeDisabled()
    await page.reload()
    await expect(row.getByLabel(/の公開日時/)).toHaveValue('')
    await expect(row.getByLabel(/の締切日時/)).toHaveValue('')
    await page.screenshot({ path: 'test-results/project-management.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('button', { name: '登録', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/project-management-mobile.png', fullPage: true })
  } finally {
    expect((await page.request.patch('/api/admin/projects', { data: { projects: original } })).status()).toBe(204)
  }
})
