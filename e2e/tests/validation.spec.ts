import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { expectAPIError } from './helpers.js'

// Build raw multipart so duplicate names, JSON part headers, binary bytes and
// metadata/part mismatches travel through the deployed public HTTP interface.
function multipart(files: { path: string; content: Buffer }[], metadata = JSON.stringify({ files: files.map((file, i) => ({ part: `file${i}`, path: file.path })) })) {
  const boundary = `validation-${randomUUID()}`
  const chunks: Buffer[] = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n`)]
  files.forEach((file, i) => chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file${i}"; filename="ignored"\r\nContent-Type: application/octet-stream\r\n\r\n`), file.content, Buffer.from('\r\n')))
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { data: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

test('Validation upload, concurrent requests, scope and input limits', async ({ request }) => {
  test.setTimeout(120_000)
  const login = await request.post('/api/session', { data: { userid: 'admin', password: 'admin' } })
  expect(login.status()).toBe(200)
  const cookie = login.headers()['set-cookie'].split(';')[0]
  const projectIDs: string[] = []
  for (const resource_id of ['ex1', 'ex2']) {
    const imported = await request.post('/api/admin/resource-imports', { data: { resource_id, version: 'v1.0.0' } })
    expect(imported.status(), await imported.text()).toBe(200)
    projectIDs.push((await imported.json()).project_id)
  }
  const url = `/api/projects/${projectIDs[0]}/validation`
  const files = [{ path: 'answer/./main.c', content: Buffer.from([0, 255, 10]) }, { path: 'Makefile', content: Buffer.alloc(0) }]
  const send = (body = multipart(files), target = url, auth = cookie) => request.post(target, {
    data: body.data, headers: { Cookie: auth, 'Content-Type': body.contentType },
  })
  await expectAPIError(await send(undefined, url, ''), 401)
  await expectAPIError(await send({ data: Buffer.from('x'), contentType: 'text/plain' }, url, ''), 401)
  // Ingress rejects oversized bodies before authentication using the shared JSON envelope.
  const oversized = { data: Buffer.alloc(21_000_001, 32), contentType: 'application/json' }
  await expectAPIError(await send(oversized, url, ''), 413)
  await expectAPIError(await send({ ...oversized, data: oversized.data.subarray(0, 21_000_000) }, url, ''), 401)
  // Other routes and methods retain the default 128 KiB limit.
  const defaultLimit = { ...oversized, data: oversized.data.subarray(0, 131_072) }
  await expectAPIError(await send(defaultLimit, '/api/admin/resource-imports', ''), 401)
  await expectAPIError(await send({ ...oversized, data: oversized.data.subarray(0, 131_073) }, '/api/admin/resource-imports', ''), 413)
  await expectAPIError(await request.put(url, { data: oversized.data, headers: { Cookie: '', 'Content-Type': oversized.contentType } }), 413)
  await expectAPIError(await request.post(url, { data: {}, headers: { Cookie: cookie, 'Content-Type': 'application/json' } }), 400)
  await expectAPIError(await send({ data: Buffer.from('x'), contentType: 'text/plain' }), 400)
  await expectAPIError(await send(undefined, `/api/projects/${randomUUID()}/validation`), 404)

  const responses = await Promise.all([send(), send()])
  expect(responses.map(r => r.status())).toEqual([201, 201])
  const created = await responses[0].json()
  expect(created).toEqual({ id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/), state: 'pending', status: null })
  expect((await responses[1].json()).id).not.toBe(created.id)
  const changed = await send(multipart([{ path: 'changed', content: Buffer.from('changed') }]))
  expect(changed.status(), await changed.text()).toBe(201)
  expect((await changed.json()).id).not.toBe(created.id)
  await expectAPIError(await send({ data: Buffer.from(JSON.stringify({ submission_id: randomUUID() })), contentType: 'Application/JSON; Charset=utf-8' }), 404)
  expect((await send(undefined, `/api/projects/${projectIDs[1]}/validation`)).status()).toBe(201)
  const again = await send()
  expect(again.status(), await again.text()).toBe(201)
  expect((await again.json()).id).not.toBe(created.id)
  await expectAPIError(await request.post(url, { data: { submission_id: randomUUID() }, headers: { Cookie: cookie } }), 404)
  for (const data of [{}, { submission_id: 'bad' }, { submission_id: randomUUID(), kind: 'evaluation' }]) {
    await expectAPIError(await request.post(url, { data, headers: { Cookie: cookie } }), 400)
  }

  for (const paths of [[], ['a', './a'], ['answer', 'answer/main.c'], ['C:/x'], Array.from({ length: 51 }, (_, i) => `file${i}`)]) {
    const response = await send(multipart(paths.map(path => ({ path, content: Buffer.alloc(0) }))))
    await expectAPIError(response, paths.length === 0 || paths.length > 50 ? 400 : 422)
    if (paths[0] === 'answer') expect((await response.json()).message).toContain('answer')
  }
  for (const path of ['../x', '/x', 'a/../x', 'a\\b']) {
    const response = await send(multipart([{ path, content: Buffer.alloc(0) }]))
    expect(response.status(), await response.text()).toBe(201)
  }
  await expectAPIError(await send(multipart(files, '{')), 400)
  await expectAPIError(await send(multipart(files, JSON.stringify({ files: [{ part: 'missing', path: 'a' }] }))), 422)
  await expectAPIError(await send(multipart(files, JSON.stringify({ files: [{ part: 'file0', path: 'a' }] }))), 422)
  await expectAPIError(await send(multipart([{ path: 'large', content: Buffer.alloc(20_000_001) }])), 400)
  await expectAPIError(await send(oversized), 413)
})

test('Validation respects Project visibility and permits every logged-in Role', async ({ request }) => {
  test.setTimeout(120_000)
  const cookies: Record<string, string> = {}
  for (const role of ['admin', 'manager', 'student']) {
    const login = await request.post('/api/session', { data: { userid: role, password: 'admin' } })
    expect(login.status()).toBe(200)
    cookies[role] = login.headers()['set-cookie'].split(';')[0]
  }
  const headers = { Cookie: cookies.admin }
  const imported = await request.post('/api/admin/resource-imports', { headers, data: { resource_id: 'ex1', version: 'v1.0.0' } })
  expect(imported.status()).toBe(200)
  const id = (await imported.json()).project_id
  const projects = (await (await request.get('/api/projects', { headers })).json()).projects
  const original = projects.map((p: { id: string; published_at: string | null; deadline: string | null }) => ({ id: p.id, published_at: p.published_at, deadline: p.deadline }))
  const visibility = (published_at: string | null) => request.patch('/api/admin/projects', { headers, data: { projects: original.map((p: { id: string }) => p.id === id ? { ...p, published_at, deadline: null } : p) } })
  const body = multipart([{ path: 'empty', content: Buffer.alloc(0) }])
  const send = (role: string) => request.post(`/api/projects/${id}/validation`, { data: body.data, headers: { Cookie: cookies[role], 'Content-Type': body.contentType } })
  try {
    expect((await visibility(null)).status()).toBe(204)
    await expectAPIError(await send('student'), 404)
    const admin = await send('admin')
    const manager = await send('manager')
    expect(admin.status(), await admin.text()).toBe(201)
    expect(manager.status(), await manager.text()).toBe(201)
    expect((await admin.json()).id).not.toBe((await manager.json()).id)
    expect((await visibility('2020-01-01T00:00:00Z')).status()).toBe(204)
    const student = await send('student')
    expect(student.status(), await student.text()).toBe(201)
    expect((await student.json()).id).not.toBe((await admin.json()).id)
  } finally {
    expect((await request.patch('/api/admin/projects', { headers, data: { projects: original } })).status()).toBe(204)
  }
})
