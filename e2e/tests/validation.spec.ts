import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { components } from '../../frontend/src/api/schema.js'
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

test('Validation detail and binary files share ownership and Project visibility rules', async ({ request }) => {
  test.setTimeout(120_000)
  const cookies: Record<string, string> = {}
  for (const role of ['admin', 'manager', 'student']) {
    const login = await request.post('/api/session', { data: { userid: role, password: 'admin' } })
    expect(login.status()).toBe(200)
    cookies[role] = login.headers()['set-cookie'].split(';')[0]
  }
  const admin = { Cookie: cookies.admin }
  const student = { Cookie: cookies.student }
  const imported = await request.post('/api/admin/resource-imports', { headers: admin, data: { resource_id: 'ex1', version: 'v1.0.0' } })
  expect(imported.status(), await imported.text()).toBe(200)
  const projectID: string = (await imported.json()).project_id
  const projects: components['schemas']['Project'][] = (await (await request.get('/api/projects', { headers: admin })).json()).projects
  const original = projects.map(({ id, published_at, deadline }) => ({ id, published_at, deadline }))
  const visibility = (published_at: string | null) => request.patch('/api/admin/projects', {
    headers: admin, data: { projects: original.map(p => p.id === projectID ? { ...p, published_at } : p) },
  })
  const files = [{ path: '日本語/answer.bin', content: Buffer.from([0, 255, 10]) }, { path: 'empty', content: Buffer.alloc(0) }]
  const upload = multipart(files)
  const create = async (headers: { Cookie: string }) => {
    const response = await request.post(`/api/projects/${projectID}/validation`, {
      headers: { ...headers, 'Content-Type': upload.contentType }, data: upload.data,
    })
    expect(response.status(), await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  const read = async (id: string, headers = student): Promise<components['schemas']['ValidationDetail']> => {
    const response = await request.get(`/api/requests/${id}/validation`, { headers })
    expect(response.status(), await response.text()).toBe(200)
    expect(response.headers()['cache-control']).toBe('no-store')
    return response.json()
  }
  try {
    expect((await visibility('2020-01-01T00:00:00Z')).status()).toBe(204)
    const id = await create(student)
    const url = `/api/requests/${id}/validation`
    const first = await read(id)
    expect(first).toMatchObject({
      id, project: { id: projectID }, subject_user: { userid: 'student' },
      version: 'v1.0.0', submission_id: expect.any(String),
      content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    })
    if (first.state !== 'completed') {
      expect(first).toMatchObject({ result: null, status: null, duration_ms: null })
      const response = await request.get(`${url}/artifacts`, { headers: student })
      // Completion can race this request; 200 is allowed only if it has completed.
      if (response.status() === 409) await expectAPIError(response, 409)
      else {
        expect(response.status(), await response.text()).toBe(200)
        expect((await read(id)).state).toBe('completed')
      }
    }
    const fileResponse = await request.get(`${url}/files`, { headers: student })
    expect(fileResponse.status(), await fileResponse.text()).toBe(200)
    expect(fileResponse.headers()['cache-control']).toBe('no-store')
    const form = await new Response(new Uint8Array(await fileResponse.body()), { headers: { 'Content-Type': fileResponse.headers()['content-type'] } }).formData()
    expect(typeof form.get('metadata')).toBe('string')
    const metadata: components['schemas']['ValidationFilesMetadata'] = JSON.parse(form.get('metadata') as string)
    expect(metadata.submission_files.map(file => file.path).sort()).toEqual(files.map(file => file.path).sort())
    for (const file of files) {
      const entry = metadata.submission_files.find(entry => entry.path === file.path)!
      const part = form.get(entry.part) as File
      expect(Buffer.from(await part.arrayBuffer())).toEqual(file.content)
    }
    expect(metadata.presets.map(group => group.workflow_id)).toEqual(['ex1-1', 'ex1-2'])
    for (const group of metadata.presets) {
      expect(group.files.length).toBeGreaterThan(0)
      for (const file of group.files) expect((form.get(file.part) as File).size).toBeGreaterThan(0)
    }
    await expect.poll(async () => (await read(id)).state, { timeout: 60_000, intervals: [1_000] }).toBe('completed')
    const detail = await read(id)
    expect(detail.status).toBe('CE')
    expect(detail.result!.workflows.map(workflow => workflow.id)).toEqual(['ex1-1', 'ex1-2'])
    for (const workflow of detail.result!.workflows) {
      expect(workflow.jobs.map(job => job.id)).toEqual(['build', 'public'])
      expect(workflow.jobs[0].status).toBe('CE')
      expect(workflow.jobs[1]).toMatchObject({ status: 'SKIP', skip_reason: expect.any(String) })
      expect(workflow.jobs[1].steps.every(step => step.status === null && step.stdout === null)).toBe(true)
      expect(workflow.jobs.every(job => job.artifacts.length === 0)).toBe(true)
    }
    const artifactResponse = await request.get(`${url}/artifacts`, { headers: student })
    expect(artifactResponse.status(), await artifactResponse.text()).toBe(200)
    const artifacts = await new Response(new Uint8Array(await artifactResponse.body()), { headers: { 'Content-Type': artifactResponse.headers()['content-type'] } }).formData()
    expect(JSON.parse(artifacts.get('metadata') as string)).toEqual({ files: [] })
    // Resubmission uses the exposed immutable Submission and creates a new Request.
    const rerun = await request.post(`/api/projects/${projectID}/validation`, { headers: student, data: { submission_id: first.submission_id } })
    expect(rerun.status(), await rerun.text()).toBe(201)
    const rerunID = (await rerun.json()).id
    expect(rerunID).not.toBe(id)
    expect((await read(rerunID)).submission_id).toBe(first.submission_id)
    const otherID = await create(admin)
    for (const suffix of ['', '/files', '/artifacts']) {
      await expectAPIError(await request.get(`${url}${suffix}`, { headers: { Cookie: '' } }), 401)
      await expectAPIError(await request.get(`/api/requests/${randomUUID()}/validation${suffix}`, { headers: admin }), 404)
      await expectAPIError(await request.get(`/api/requests/${otherID}/validation${suffix}`, { headers: student }), 404)
      await expectAPIError(await request.get(`/api/requests/not-a-uuid/validation${suffix}`, { headers: admin }), 400)
    }
    expect((await visibility(null)).status()).toBe(204)
    for (const suffix of ['', '/files', '/artifacts']) {
      await expectAPIError(await request.get(`${url}${suffix}`, { headers: student }), 404)
      for (const role of ['admin', 'manager']) {
        const response = await request.get(`${url}${suffix}`, { headers: { Cookie: cookies[role] } })
        expect(response.status(), await response.text()).toBe(200)
      }
    }
  } finally {
    expect((await request.patch('/api/admin/projects', { headers: admin, data: { projects: original } })).status()).toBe(204)
  }
})

test('Judge completes repeated correct submissions and enforces runtime limits', async ({ request }) => {
  test.setTimeout(300_000)
  expect((await request.post('/api/session', { data: { userid: 'admin', password: 'admin' } })).status()).toBe(200)
  const imported = await request.post('/api/admin/resource-imports', { data: { resource_id: 'ex1', version: 'v1.0.0' } })
  expect(imported.status(), await imported.text()).toBe(200)
  const projectID = (await imported.json()).project_id
  const files = await Promise.all(['Makefile', 'gcd_euclid.c', 'gcd_recursive.c', 'main_euclid.c', 'main_recursive.c'].map(async path => ({
    path, content: await readFile(new URL(`../fixtures/validation-ex1/${path}`, import.meta.url)),
  })))
  const cases = [
    ...Array.from({ length: 12 }, (_, i) => ({ name: `correct ${i}`, status: 'AC', main: '' })),
    { name: 'timeout with buffered diagnostics', status: 'TLE', main: 'puts("before timeout"); fprintf(stderr, "timeout diagnostic\\n"); sleep(30);' },
    { name: 'closed standard streams', status: 'TLE', main: 'close(0); close(1); close(2); sleep(30);' },
    { name: 'child holding stdout', status: 'TLE', main: 'if (fork() == 0) sleep(30);' },
    { name: 'stdout overflow', status: 'OLE', main: 'for (;;) puts("stdout overflow");' },
    { name: 'stderr overflow', status: 'OLE', main: 'for (;;) fputs("stderr overflow\\n", stderr);' },
    { name: 'memory with buffered diagnostics', status: 'MLE', main: 'puts("before memory limit"); fprintf(stderr, "memory diagnostic\\n"); for (;;) { volatile char *p = malloc(16 * 1024 * 1024); if (!p) return 2; for (int i = 0; i < 16 * 1024 * 1024; i += 4096) p[i] = 1; usleep(10000); }' },
    // Both parent and child keep forking until the Sandbox PID limit rejects it.
    // Stay alive without output afterward so the Step must time out.
    { name: 'fork bomb', status: 'TLE', main: 'while (fork() >= 0) {} sleep(30);' },
  ]
  const submitted: { name: string; status: string; id: string }[] = []
  for (const scenario of cases) {
    const body = multipart(files.map(file => file.path === 'main_euclid.c' && scenario.main
      ? { ...file, content: Buffer.from(`#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\nint main(void) { ${scenario.main} return 0; }\n`) }
      : file))
    const response = await request.post(`/api/projects/${projectID}/validation`, { data: body.data, headers: { 'Content-Type': body.contentType } })
    expect(response.status(), await response.text()).toBe(201)
    submitted.push({ ...scenario, id: (await response.json()).id })
  }
  let results: components['schemas']['ValidationSummary'][] = []
  await expect(async () => {
    const response = await request.get('/api/validation', { params: { project_id: projectID } })
    expect(response.status()).toBe(200)
    const page: components['schemas']['ValidationPage'] = await response.json()
    results = page.requests
    for (const scenario of submitted) {
      const row = page.requests.find(row => row.id === scenario.id)
      expect(row, `${scenario.name}: ${scenario.id}`).toMatchObject({ state: 'completed', duration_ms: expect.any(Number) })
    }
  }).toPass({ timeout: 240_000, intervals: [5_000] })
  for (const scenario of submitted) {
    expect(results.find(row => row.id === scenario.id)?.status, `${scenario.name}: ${scenario.id}`).toBe(scenario.status)
    const response = await request.get(`/api/requests/${scenario.id}/validation`)
    expect(response.status(), await response.text()).toBe(200)
    const detail: components['schemas']['ValidationDetail'] = await response.json()
    expect(detail).toMatchObject({ state: 'completed', status: scenario.status, result: { workflows: expect.any(Array) } })
    const steps = detail.result!.workflows.flatMap(workflow => workflow.jobs.flatMap(job => job.steps))
    if (scenario.name === 'timeout with buffered diagnostics' || scenario.name === 'memory with buffered diagnostics') {
      expect(steps.some(step => Buffer.from(step.stdout?.data ?? '', 'base64').toString().includes(scenario.status === 'TLE' ? 'before timeout' : 'before memory limit'))).toBe(true)
      expect(steps.some(step => Buffer.from(step.stderr?.data ?? '', 'base64').toString().includes('diagnostic'))).toBe(true)
    }
    if (scenario.name === 'stdout overflow') expect(steps.some(step => step.stdout?.truncated)).toBe(true)
    if (scenario.name === 'stderr overflow') expect(steps.some(step => step.stderr?.truncated)).toBe(true)
  }

  // Submit only after the fork bomb completes to check that the Judge recovers.
  const recoveryBody = multipart(files)
  const recovery = await request.post(`/api/projects/${projectID}/validation`, { data: recoveryBody.data, headers: { 'Content-Type': recoveryBody.contentType } })
  expect(recovery.status(), await recovery.text()).toBe(201)
  const recoveryID = (await recovery.json()).id
  await expect(async () => {
    const response = await request.get('/api/validation', { params: { project_id: projectID } })
    expect(response.status()).toBe(200)
    const page: components['schemas']['ValidationPage'] = await response.json()
    expect(page.requests.find(row => row.id === recoveryID)).toMatchObject({ state: 'completed', status: 'AC' })
  }).toPass({ timeout: 30_000, intervals: [1_000] })
})

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

test('Validation list filters, authorization and bidirectional 20-item pages', async ({ request }) => {
  test.setTimeout(120_000)
  const adminLogin = await request.post('/api/session', { data: { userid: 'admin', password: 'admin' } })
  expect(adminLogin.status()).toBe(200)
  const admin = { Cookie: adminLogin.headers()['set-cookie'].split(';')[0] }
  const userid = `pagination-${randomUUID().slice(0, 8)}`
  const createdUser = await request.post('/api/admin/users', { headers: admin, data: { userid, name: 'Pagination Student', role: 'student', password: 'password123' } })
  expect(createdUser.status(), await createdUser.text()).toBe(201)
  const login = await request.post('/api/session', { data: { userid, password: 'password123' } })
  expect(login.status()).toBe(200)
  const student = { Cookie: login.headers()['set-cookie'].split(';')[0] }
  const managerLogin = await request.post('/api/session', { data: { userid: 'manager', password: 'admin' } })
  expect(managerLogin.status()).toBe(200)
  const manager = { Cookie: managerLogin.headers()['set-cookie'].split(';')[0] }
  const projectIDs: string[] = []
  for (const resource_id of ['ex1', 'ex2']) {
    const imported = await request.post('/api/admin/resource-imports', { headers: admin, data: { resource_id, version: 'v1.0.0' } })
    expect(imported.status(), await imported.text()).toBe(200)
    projectIDs.push((await imported.json()).project_id)
  }
  const projects = (await (await request.get('/api/projects', { headers: admin })).json()).projects
  const original = projects.map((p: { id: string; published_at: string | null; deadline: string | null }) => ({ id: p.id, published_at: p.published_at, deadline: p.deadline }))
  const visibility = (published_at: string | null) => request.patch('/api/admin/projects', {
    headers: admin, data: { projects: original.map((p: { id: string }) => projectIDs.includes(p.id) ? { ...p, published_at, deadline: null } : p) },
  })
  type Page = components['schemas']['ValidationPage']
  const list = async (params: Record<string, string> = {}, headers = student): Promise<Page> => {
    const response = await request.get('/api/validation', { params, headers })
    expect(response.status(), await response.text()).toBe(200)
    expect(response.headers()['cache-control']).toBe('no-store')
    const page: Page = await response.json()
    expect(page.requests.length).toBeLessThanOrEqual(20)
    const ids = page.requests.map(r => r.id)
    expect(ids).toEqual([...ids].sort().reverse())
    return page
  }
  // The example solution covers both public Workflows; pagination never waits
  // for Judge completion or requires AC to become available.
  const files = await Promise.all(['Makefile', 'gcd_euclid.c', 'gcd_recursive.c', 'main_euclid.c', 'main_recursive.c'].map(async path => ({
    path, content: await readFile(new URL(`../fixtures/validation-ex1/${path}`, import.meta.url)),
  })))
  const body = multipart(files)
  const send = async (projectID: string, headers = student) => {
    const response = await request.post(`/api/projects/${projectID}/validation`, { data: body.data, headers: { ...headers, 'Content-Type': body.contentType } })
    expect(response.status(), await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  try {
    expect((await visibility('2020-01-01T00:00:00Z')).status()).toBe(204)
    expect(await list()).toEqual({ requests: [], next: null, prev: null })
    await expectAPIError(await request.get('/api/validation', { headers: { Cookie: '' } }), 401)
    const ids: string[] = []
    for (let i = 0; i < 41; i++) ids.push(await send(projectIDs[0]))
    ids.sort().reverse()
    const params = { project_id: projectIDs[0] }
    const first = await list(params)
    expect(first.requests.map(r => r.id)).toEqual(ids.slice(0, 20))
    expect(first.prev).toBeNull()
    expect(first.next).toBe(ids[19])
    const second = await list({ ...params, next: first.next! })
    expect(second.requests.map(r => r.id)).toEqual(ids.slice(20, 40))
    expect(second.prev).toBe(ids[20])
    expect(second.next).toBe(ids[39])
    const third = await list({ ...params, next: second.next! })
    expect(third.requests.map(r => r.id)).toEqual(ids.slice(40))
    expect(third.prev).toBe(ids[40])
    expect(third.next).toBeNull()
    const back = await list({ ...params, prev: third.prev! })
    expect(back.requests.map(r => r.id)).toEqual(ids.slice(20, 40))
    expect(back.next).toBe(second.next)
    expect(back.prev).toBe(second.prev)
    const beginning = await list({ ...params, prev: back.prev! })
    expect(beginning.requests.map(r => r.id)).toEqual(ids.slice(0, 20))
    expect(beginning.prev).toBeNull()
    expect(await list({ ...params, next: ids[40] })).toEqual({ requests: [], next: null, prev: null })
    expect(await list({ ...params, prev: ids[0] })).toEqual({ requests: [], next: null, prev: null })
    // A cursor is a boundary, not a row lookup.
    expect((await list({ ...params, next: 'ffffffff-ffff-7fff-bfff-ffffffffffff' })).requests.map(r => r.id)).toEqual(ids.slice(0, 20))
    for (const row of first.requests) {
      expect(row).toMatchObject({ project: { id: projectIDs[0], name: expect.any(String) }, subject_user: { id: expect.any(String), userid, name: 'Pagination Student' }, version: 'v1.0.0', content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), requested_at: expect.any(String) })
      expect(Number.isNaN(Date.parse(row.requested_at))).toBe(false)
      if (row.state !== 'completed') expect(row).toMatchObject({ status: null, duration_ms: null })
    }
    expect(new Set(first.requests.map(r => r.content_hash)).size).toBe(1)
    // Another user's Request never leaks to Student, including in All.
    const otherUserID = await send(projectIDs[0], admin)
    expect((await list()).requests.map(r => r.id)).toEqual(ids.slice(0, 20))
    for (const headers of [admin, manager]) {
      const all = await list({}, headers)
      expect(all.requests.map(r => r.id)).toContain(otherUserID)
    }
    expect(await list({ project_id: projectIDs[1] })).toEqual({ requests: [], next: null, prev: null })
    const incomplete = await list({ ...params, state: 'incomplete' })
    for (const row of incomplete.requests) expect(['pending', 'running', 'retrying']).toContain(row.state)
    for (const status of ['AC', 'WA', 'TLE', 'MLE', 'RE', 'OLE', 'IE', 'CE', 'SKIP']) {
      const filtered = await list({ ...params, status })
      for (const row of filtered.requests) expect(row).toMatchObject({ state: 'completed', status })
      if (filtered.next) {
        const next = await list({ ...params, status, next: filtered.next })
        for (const row of next.requests) expect(row).toMatchObject({ state: 'completed', status })
      }
    }
    const invalidQueries: Record<string, string>[] = [
      { next: ids[0], prev: ids[40] }, { status: 'AC', state: 'incomplete' },
      { next: 'bad' }, { prev: '' }, { project_id: 'bad' }, { status: 'bad' }, { state: 'completed' }, { status: '' },
    ]
    for (const invalid of invalidQueries) {
      await expectAPIError(await request.get('/api/validation', { headers: student, params: invalid }), 400)
    }
    await expectAPIError(await request.get('/api/validation', { headers: admin, params: { project_id: randomUUID() } }), 404)
    expect((await visibility(null)).status()).toBe(204)
    expect(await list()).toEqual({ requests: [], next: null, prev: null })
    await expectAPIError(await request.get('/api/validation', { headers: student, params }), 404)
    expect((await list(params, manager)).requests.length).toBe(20)
  } finally {
    expect((await request.patch('/api/admin/projects', { headers: admin, data: { projects: original } })).status()).toBe(204)
  }
})
