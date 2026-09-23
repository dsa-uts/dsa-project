import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { components } from '@/api/schema'
import App from './App'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const project: components['schemas']['ProjectDetail'] = {
  id: 'project-1', resource_id: 'ex1', name: 'C言語の復習', latest_version_id: 'version-1', latest_version: 'v1.0.0',
  display_order: 0, published_at: null, deadline: null, my_result: null,
  required_files: ['main.c', '*.h', 'レポート.pdf（任意）'],
  workflows: [
    { id: 'ex1-1', name: '基本課題', description_markdown: '# 基本課題\n\n[課題リンク](https://example.com/task)\n\n## ファイル `main.c`\n\n```c\n// ## Not a heading\nint main(void) { return 0; }\n```\n\n# 提出方法\n本文\n\n## 提出方法\n別の説明\n<script>alert(1)</script>\n\n![添付画像](./private.png)' },
    { id: 'ex1-2', name: '発展課題', description_markdown: '' },
  ],
}

function setup(path = '/projects/project-1', load = async () => Response.json(project)) {
  const fetchDetail = vi.fn(load)
  const fetchMock = vi.fn(async (request: Request) => {
    const pathname = new URL(request.url).pathname
    if (pathname === '/api/me') return Response.json({ id: 'student', userid: 'student', name: 'Student', role: 'student' })
    if (pathname === '/api/projects') return Response.json({ projects: [project] })
    if (pathname === '/api/projects/project-1') return fetchDetail()
    throw new Error(`Unexpected API: ${pathname}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  const router = createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: [path] })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)
  return { router, fetchDetail, fetchMock }
}

test('dashboard links to a Workflow; detail renders safe Markdown, real heading anchors and display-only file guidance', async () => {
  const { fetchDetail, fetchMock, router } = setup('/projects')
  fireEvent.click(await screen.findByRole('link', { name: '基本課題' }))
  expect(await screen.findByRole('heading', { level: 1, name: '基本課題' })).toBeDefined()
  expect(router.state.location.pathname).toBe('/projects/project-1/ex1-1')
  const outline = within(screen.getByRole('navigation', { name: '課題の目次' }))
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  const anchors = outline.getAllByRole('link', { name: '提出方法' })
  expect(anchors[0].getAttribute('href')).not.toBe(anchors[1].getAttribute('href'))
  for (const anchor of anchors) expect(document.querySelector(anchor.getAttribute('href')!)).toHaveProperty('textContent', '提出方法')
  expect(outline.queryByText('Not a heading')).toBeNull()
  fireEvent.click(outline.getByRole('link', { name: '基本課題' }))
  expect(outline.queryByRole('link', { name: 'ファイル main.c' })).toBeNull()
  fireEvent.click(outline.getByRole('link', { name: '基本課題' }))
  expect(outline.getByRole('link', { name: 'ファイル main.c' })).toBeDefined()
  expect(screen.getByRole('link', { name: '課題リンク' }).getAttribute('href')).toBe('https://example.com/task')
  expect(document.querySelector('script')).toBeNull()
  expect(screen.queryByRole('img')).toBeNull()
  expect(within(screen.getByRole('list', { name: '提出が求められているファイル' })).getAllByRole('listitem').map(item => item.textContent)).toEqual(project.required_files)
  expect(screen.getByRole('button', { name: '提出する' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: 'ファイルを選択' })).toHaveProperty('disabled', true)
  fireEvent.click(outline.getByRole('link', { name: '発展課題' }))
  expect(await screen.findByText('課題説明はまだ登録されていません。')).toBeDefined()
  expect(fetchDetail).toHaveBeenCalledTimes(1)
  await act(async () => { await router.navigate(-1) })
  expect(screen.getByRole('heading', { level: 1, name: '基本課題' })).toBeDefined()
  expect(fetchMock.mock.calls.every(([request]) => request.method === 'GET')).toBe(true)
})

test('direct Workflow URLs, default selection and unknown Workflow recovery', async () => {
  const { router } = setup('/projects/project-1/ex1-2')
  expect(await screen.findByRole('heading', { level: 1, name: '発展課題' })).toBeDefined()
  await act(async () => { await router.navigate('/projects/project-1/missing') })
  expect(screen.getByRole('alert').textContent).toContain('指定された問題が見つかりません。')
  await act(async () => { await router.navigate('/projects/project-1') })
  expect(screen.getByRole('heading', { level: 1, name: '基本課題' })).toBeDefined()
})

test('not-found and server failures are recoverable without showing stale content', async () => {
  let status = 404
  setup('/projects/project-1', async () => status === 200 ? Response.json({ ...project, required_files: [] }) : Response.json({ error: { code: status === 404 ? 'not_found' : 'internal_error', message: 'Unavailable' } }, { status }))
  expect((await screen.findByRole('alert')).textContent).toContain('公開されていません')
  status = 500
  fireEvent.click(screen.getByRole('button', { name: '再読み込み' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('課題を取得できませんでした。'))
  status = 200
  fireEvent.click(screen.getByRole('button', { name: '再読み込み' }))
  await screen.findByRole('heading', { level: 1, name: '基本課題' })
  expect(screen.queryByRole('list', { name: '提出が求められているファイル' })).toBeNull()
})

test('outline omits raw HTML blocks while retaining heading links', async () => {
  setup('/projects/project-1', async () => Response.json({ ...project, workflows: [{
    id: 'ex1-1', name: '基本課題',
    description_markdown: '# 基本課題\n\n## 入力\n\n<div style="background-color: #f0f0f0;">\n\n本文<br>\n\n</div>\n\n## 制約\n条件',
  }] }))
  await screen.findByRole('heading', { level: 1, name: '基本課題' })
  const outline = screen.getByRole('navigation', { name: '課題の目次' })
  expect(within(outline).getByRole('link', { name: '入力' })).toBeDefined()
  expect(within(outline).getByRole('link', { name: '制約' })).toBeDefined()
  expect(outline.textContent).not.toContain('<div')
  expect(outline.textContent).not.toContain('</div>')
})

test('outline nests headings under the nearest shallower heading without empty levels', async () => {
  setup('/projects/project-1', async () => Response.json({ ...project, workflows: [{
    id: 'ex1-1', name: '基本課題',
    description_markdown: '# 基本課題\n\n## 最初の節\n\n# 課題\n\n#### テスト `main.c`\n\n#### 具体例\n\n##### 入力\n\n###### 詳細\n\n##### 出力\n\n## [提出方法](https://example.com)\n\n# 次の課題',
  }] }))
  await screen.findByRole('heading', { level: 1, name: '基本課題' })
  const outline = screen.getByRole('navigation', { name: '課題の目次' })
  const lists = within(outline).getAllByRole('list')
  const labels = (list: HTMLElement) => Array.from(list.children).map(item => item.firstElementChild?.textContent)
  expect(lists.map(labels)).toEqual([
    ['最初の節', '課題', '次の課題'],
    ['テスト main.c', '具体例', '提出方法'],
    ['入力', '出力'],
    ['詳細'],
  ])
  expect(outline.querySelector('a a')).toBeNull()
  for (const link of outline.querySelectorAll('a[href^="#section-"]')) {
    expect(document.querySelector(link.getAttribute('href')!)?.textContent).toBe(link.textContent)
  }
})

test('detail uses the shared historical result popover', async () => {
  setup('/projects/project-1', async () => Response.json({ ...project, my_result: {
    submission_id: 'submission-1', content_hash: `sha256:${'a'.repeat(64)}`, uploaded_at: '2026-09-22T00:00:00Z',
    request: { id: 'request-1', version_id: 'old-version', version: 'v0.9.0', state: 'completed', status: 'WA', workflows: [{ id: 'old', name: '更新前の課題', status: 'WA', duration_ms: 120 }] },
  } }))
  fireEvent.click(await screen.findByRole('button', { name: 'C言語の復習 の提出結果' }))
  const popup = within(await screen.findByRole('dialog'))
  expect(popup.getByText('更新前の課題')).toBeDefined()
  expect(popup.getByText('0.12 s')).toBeDefined()
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
