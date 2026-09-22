import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { components } from '@/api/schema'
import App from './App'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const project: components['schemas']['Project'] = {
  id: 'project-1', resource_id: 'ex1', name: '課題1', latest_version_id: 'version-2', latest_version: 'v2.0.0',
  display_order: 0, published_at: null, deadline: null,
  workflows: [{ id: 'new', name: '最新版の問題' }],
  my_result: {
    submission_id: 'submission-1', content_hash: `sha256:${'2a7396e'.padEnd(64, '0')}`, uploaded_at: '2026-09-22T00:00:00Z',
    request: { id: 'request-1', version_id: 'version-1', version: 'v1.0.0', state: 'completed', status: 'WA', workflows: [
      { id: 'old-1', name: '旧問題1', status: 'AC', duration_ms: 120 },
      { id: 'old-2', name: '旧問題2', status: 'WA', duration_ms: 0 },
      { id: 'old-3', name: '旧問題3', status: 'TLE', duration_ms: null },
    ] },
  },
}
const noResult = { ...project, id: 'project-2', name: '課題2', my_result: null }

function setup(list = async () => Response.json({ projects: [project, noResult] })) {
  const fetchList = vi.fn(list)
  vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname
    if (path === '/api/me') return Response.json({ id: 'student', userid: 'student', name: 'Student', role: 'student' })
    if (path === '/api/projects') return fetchList()
    throw new Error(`Unexpected API: ${path}`)
  }))
  const router = createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: ['/projects'] })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)
  return { fetchList, router }
}

test('filters fetched Projects without navigation and shows no-result Projects without a popover', async () => {
  const { fetchList, router } = setup()
  await screen.findByRole('heading', { name: '課題1' })
  expect(screen.getByText('実行結果なし')).toBeDefined()
  expect(screen.queryByRole('button', { name: '課題2 の提出結果' })).toBeNull()
  fireEvent.mouseDown(screen.getByRole('tab', { name: '課題2' }), { button: 0, ctrlKey: false })
  expect(screen.queryByRole('heading', { name: '課題1' })).toBeNull()
  expect(screen.getByRole('heading', { name: '課題2' })).toBeDefined()
  expect(router.state.location.pathname).toBe('/projects')
  fireEvent.keyDown(screen.getByRole('tab', { name: 'All' }), { key: 'Enter' })
  expect(screen.getByRole('heading', { name: '課題1' })).toBeDefined()
  expect(fetchList).toHaveBeenCalledTimes(1)
})

test('popover uses historical Workflow names, counts and durations, and closes with Escape', async () => {
  setup()
  const summary = await screen.findByRole('button', { name: '課題1 の提出結果' })
  expect(summary.className).toContain('border-dashed')
  fireEvent.focus(summary)
  expect(await screen.findByRole('tooltip')).toHaveProperty('textContent', '旧Version v1.0.0 の結果です。最新版は v2.0.0 です。')
  fireEvent.click(summary)
  const popup = within(await screen.findByRole('dialog'))
  expect(popup.getByText('2a7396e')).toBeDefined()
  expect(popup.getByText('1 AC / 3')).toBeDefined()
  expect(popup.getByText('旧問題1')).toBeDefined()
  expect(popup.queryByText('最新版の問題')).toBeNull()
  expect(popup.getByText('0.12 s')).toBeDefined()
  expect(popup.getByText('0.00 s')).toBeDefined()
  expect(popup.getByText('—')).toBeDefined()
  expect(popup.getAllByRole('button', { name: 'Details' }).every((button) => button.hasAttribute('disabled'))).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('pending results hide judgments and durations, poll after 5 seconds and stop when completed', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  let running = true
  const { fetchList } = setup(async () => Response.json({ projects: [{ ...project, my_result: { ...project.my_result, request: { ...project.my_result!.request, state: running ? 'running' : 'completed' } } }] }))
  fireEvent.click(await screen.findByRole('button', { name: '課題1 の提出結果' }))
  const popup = within(await screen.findByRole('dialog'))
  expect(popup.queryByText('0.12 s')).toBeNull()
  expect(popup.queryByText('AC')).toBeNull()
  expect(popup.getAllByText('—')).toHaveLength(7)
  running = false
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  await waitFor(() => expect(popup.getByText('0.12 s')).toBeDefined())
  expect(fetchList).toHaveBeenCalledTimes(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(fetchList).toHaveBeenCalledTimes(2)
})

test('a failed list load can be retried and an empty list is explicit', async () => {
  let fails = true
  setup(async () => fails ? Response.json({ error: { code: 'internal_error', message: 'Unavailable' } }, { status: 500 }) : Response.json({ projects: [] }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('課題一覧を取得できませんでした。'))
  fails = false
  fireEvent.click(screen.getByRole('button', { name: '再読み込み' }))
  expect(await screen.findByText('表示できる課題はありません。')).toBeDefined()
  expect(screen.queryByRole('alert')).toBeNull()
})
