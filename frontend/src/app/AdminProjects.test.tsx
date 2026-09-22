import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import App from './App'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const project = { id: 'project-1', resource_id: 'ex1', name: '課題1', latest_version_id: 'version-1', latest_version: 'v1.0.0', display_order: 0, published_at: '2026-09-12T10:59:00Z', deadline: null, workflows: [], my_result: null }
function setup(patch: (request: Request) => Promise<Response>, role = 'admin', projects = [project]) {
  const fetch = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname
    if (request.method === 'PATCH') return patch(request)
    const body = path === '/api/me' ? { id: 'admin', userid: role, name: role, role } : { projects }
    return Response.json(body)
  })
  vi.stubGlobal('fetch', fetch)
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: ['/admin/projects'] })} /></QueryClientProvider>)
  return fetch
}

test('failed saves preserve JST edits for retry and send all schedules in UTC', async () => {
  const patch = vi.fn(async (_request: Request) => Response.json({ error: { code: 'internal_error', message: '保存に失敗しました' } }, { status: 500 }))
  setup(patch)
  const input = await screen.findByLabelText('課題1 の公開日時')
  expect((input as HTMLInputElement).value).toBe('2026-09-12T19:59')
  fireEvent.change(input, { target: { value: '2026-09-13T00:15' } })
  fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '保存に失敗しました')
  expect((input as HTMLInputElement).value).toBe('2026-09-13T00:15')
  expect(await patch.mock.calls[0][0].clone().json()).toEqual({ projects: [{ id: 'project-1', published_at: '2026-09-12T15:15:00.000Z', deadline: null }] })
  fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect((input as HTMLInputElement).value).toBe('2026-09-12T19:59')
})

test('a changed project list requires explicit reload without silently discarding edits', async () => {
  const patch = vi.fn(async (_request: Request) => Response.json({ error: { code: 'project_ids_mismatch', message: 'Reload' } }, { status: 422 }))
  setup(patch)
  const input = await screen.findByLabelText('課題1 の公開日時')
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
  const reload = await screen.findByRole('button', { name: '編集を破棄して再読み込み' })
  expect((input as HTMLInputElement).value).toBe('')
  expect(screen.getByRole('button', { name: '変更を保存' })).toHaveProperty('disabled', true)
  fireEvent.click(reload)
  await waitFor(() => expect((input as HTMLInputElement).value).toBe('2026-09-12T19:59'))
})

test('invalid schedules are rejected before sending and navigation preserves unsaved edits', async () => {
  const patch = vi.fn(async (_request: Request) => new Response(null, { status: 204 }))
  setup(patch)
  const input = await screen.findByLabelText('課題1 の締切日時')
  fireEvent.change(input, { target: { value: '2026-09-11T19:59' } })
  fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '締切日時は公開日時以降に設定してください。')
  expect(patch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('link', { name: 'Admin Page' }))
  expect(await screen.findByRole('dialog')).toHaveProperty('textContent', expect.stringContaining('日時・表示順の変更は保存されません。'))
  fireEvent.click(screen.getByRole('button', { name: '戻る' }))
  expect((input as HTMLInputElement).value).toBe('2026-09-11T19:59')
})

test.each(['student', 'manager'])('%s cannot open project management or fetch its list', async (role) => {
  const fetch = setup(async () => new Response(null, { status: 204 }), role)
  expect(await screen.findByRole('heading', { name: '403 Forbidden' })).toBeDefined()
  expect(fetch.mock.calls.some(([request]) => new URL(request.url).pathname === '/api/projects')).toBe(false)
})

test('import failures retain input and prevent duplicate requests while retrying', async () => {
  setup(async () => new Response(null, { status: 204 }))
  await screen.findByLabelText('課題1 の公開日時')
  let finish!: (response: Response) => void
  const importRequest = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve }))
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', (request: Request) => request.method === 'POST' ? importRequest() : originalFetch(request))
  fireEvent.change(screen.getByLabelText('リソースID'), { target: { value: 'ex1' } })
  fireEvent.change(screen.getByLabelText('バージョン'), { target: { value: 'v1.0.0' } })
  const form = screen.getByRole('form', { name: '新しいバージョンを登録' })
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(importRequest).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '登録' })).toHaveProperty('disabled', true)
  finish(Response.json({ error: { code: 'resource_source_unavailable', message: '取得元に接続できません' } }, { status: 503 }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '取得元に接続できません')
  expect(screen.getByLabelText('バージョン')).toHaveProperty('value', 'v1.0.0')
  fireEvent.submit(form)
  expect(importRequest).toHaveBeenCalledTimes(2)
  finish(Response.json({ changed: false, project_id: 'project-1', version_id: 'version-1', resource_id: 'ex1', version: 'v1.0.0' }))
  expect(await screen.findByText('同じバージョンが登録済みです。変更はありません。')).toBeDefined()
  await waitFor(() => expect(screen.getByRole('button', { name: '登録' })).toHaveProperty('disabled', false))
})

test('keyboard reordering keeps schedules attached to projects and cancellation restores order', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rows = Array.from(document.querySelectorAll('tbody tr'))
    const index = rows.indexOf(this.closest('tr')!)
    return { x: 0, y: index * 60, top: index * 60, bottom: (index + 1) * 60, left: 0, right: 800, width: 800, height: 60, toJSON() {} }
  })
  const patch = vi.fn(async (_request: Request) => Response.json({ error: { code: 'internal_error', message: 'Retry' } }, { status: 500 }))
  setup(patch, 'admin', [project, { ...project, id: 'project-2', name: '課題2', resource_id: 'ex2' }])
  const handle = await screen.findByRole('button', { name: '課題2 を移動' })
  handle.focus()
  fireEvent.keyDown(handle, { code: 'Space' })
  await waitFor(() => expect(handle.getAttribute('aria-pressed')).toBe('true'))
  // dnd-kit attaches the keyboard listener after activation.
  await new Promise((resolve) => setTimeout(resolve, 0))
  fireEvent.keyDown(document, { code: 'ArrowUp' })
  fireEvent.keyDown(document, { code: 'Space' })
  await waitFor(() => expect(screen.getAllByRole('rowheader').map((row) => row.textContent)).toEqual(['課題2', '課題1']))
  fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
  await screen.findByText('Retry')
  expect(await patch.mock.calls[0][0].clone().json()).toEqual({ projects: [
    { id: 'project-2', published_at: '2026-09-12T10:59:00Z', deadline: null },
    { id: 'project-1', published_at: '2026-09-12T10:59:00Z', deadline: null },
  ] })
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(screen.getAllByRole('rowheader').map((row) => row.textContent)).toEqual(['課題1', '課題2'])
})

test('a failed refresh after saving cannot restore stale schedules on the next save', async () => {
  const patch = vi.fn(async (_request: Request) => new Response(null, { status: 204 }))
  setup(patch)
  const publication = await screen.findByLabelText('課題1 の公開日時')
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', (request: Request) => new URL(request.url).pathname === '/api/projects' ? Promise.resolve(Response.json({ error: { code: 'internal_error', message: 'Unavailable' } }, { status: 500 })) : originalFetch(request))
  fireEvent.change(publication, { target: { value: '2026-09-13T00:15' } })
  fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
  await screen.findByRole('alert')
  expect(publication).toHaveProperty('value', '2026-09-13T00:15')
  fireEvent.change(screen.getByLabelText('課題1 の締切日時'), { target: { value: '2026-09-19T19:59' } })
  fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(2))
  expect(await patch.mock.calls[1][0].clone().json()).toEqual({ projects: [{ id: 'project-1', published_at: '2026-09-12T15:15:00.000Z', deadline: '2026-09-19T10:59:00.000Z' }] })
  await screen.findByRole('alert')
})
