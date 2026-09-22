import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'

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
    expect((await save(updates.map((p: { id: string }) => ({ ...p, published_at: '2999-01-01T00:00:00Z', deadline: null })))).status()).toBe(204)
    expect(await list(student)).toEqual([])
    const scheduled = await list()
    expect((await request.post('/api/admin/resource-imports', { headers, data })).status()).toBe(200)
    expect(await list()).toEqual(scheduled)
  } finally {
    expect((await save(original)).status()).toBe(204)
  }
})
