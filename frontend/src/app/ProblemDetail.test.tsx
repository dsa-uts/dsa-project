import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { components } from '@/api/schema'
import App from './App'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const project: components['schemas']['ProjectDetail'] = {
  id: 'project-1', resource_id: 'ex1', name: '課題1', description: 'C言語によるプログラミングの復習', latest_version_id: 'version-1', latest_version: 'v1.0.0',
  display_order: 0, published_at: null, deadline: null,
  required_files: ['main.c', '*.h', 'レポート.pdf（任意）'],
  workflows: [
    { id: 'ex1-1', name: '基本課題', description_markdown: '# 基本課題\n\n[課題リンク](https://example.com/task)\n\n## ファイル `main.c`\n\n```c\n// ## Not a heading\nint main(void) { return 0; }\n```\n\n# 提出方法\n本文\n\n## 提出方法\n別の説明\n<script>alert(1)</script>\n\n![添付画像](./private.png)' },
    { id: 'ex1-2', name: '発展課題', description_markdown: '' },
  ],
}

const secondProject = { ...project, id: 'project-2', name: '課題2', description: '連結リスト', workflows: [{ id: 'ex2-1', name: '課題2-1', description_markdown: '課題2の本文' }] }

function setup(path = '/projects/project-1', load = async () => Response.json(project), loadList = async () => Response.json({ projects: [project, secondProject] })) {
  const fetchDetail = vi.fn(load)
  const fetchMock = vi.fn(async (request: Request) => {
    const pathname = new URL(request.url).pathname
    if (pathname === '/api/me') return Response.json({ id: 'student', userid: 'student', name: 'Student', role: 'student' })
    if (pathname === '/api/projects') return loadList()
    if (pathname === '/api/projects/project-2') return Response.json(secondProject)
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
  expect(screen.getByRole('combobox', { name: '課題を選択' })).toHaveProperty('textContent', project.name)
  expect(screen.getByText(project.description)).toBeDefined()
  const outline = within(screen.getByRole('navigation', { name: '課題の目次' }))
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(2)
  const anchors = outline.getAllByRole('link', { name: '提出方法' })
  expect(anchors[0].getAttribute('href')).not.toBe(anchors[1].getAttribute('href'))
  for (const anchor of anchors) expect(document.getElementById(anchor.getAttribute('href')!.split('#')[1])).toHaveProperty('textContent', '提出方法')
  expect(outline.queryByText('Not a heading')).toBeNull()
  fireEvent.click(outline.getByRole('button', { name: '基本課題の目次を開閉' }))
  expect(outline.queryByRole('link', { name: 'ファイル main.c' })).toBeNull()
  fireEvent.click(outline.getByRole('button', { name: '基本課題の目次を開閉' }))
  expect(outline.getByRole('link', { name: 'ファイル main.c' })).toBeDefined()
  expect(screen.getByRole('link', { name: '課題リンク' }).getAttribute('href')).toBe('https://example.com/task')
  expect(document.querySelector('script')).toBeNull()
  expect(screen.queryByRole('img')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '課題を提出' }))
  expect(within(screen.getByRole('list', { name: '提出が求められているファイル' })).getAllByRole('listitem').map(item => item.textContent)).toEqual(project.required_files)
  expect(screen.getByRole('button', { name: '提出する' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: 'ファイルを選択' })).toHaveProperty('disabled', false)
  fireEvent.click(outline.getByRole('button', { name: '発展課題の目次を開閉' }))
  expect(await screen.findByText('課題説明はまだ登録されていません。')).toBeDefined()
  expect(fetchDetail).toHaveBeenCalledTimes(1)
  expect(router.state.location.pathname).toBe('/projects/project-1/ex1-1')
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

test('submission panel keeps files across closing and Workflow navigation, but resets for another Project', async () => {
  const { router } = setup()
  const trigger = await screen.findByRole('button', { name: '課題を提出' })
  expect(screen.queryByRole('dialog')).toBeNull()
  const content = screen.getByRole('region', { name: '課題本文' })
  content.scrollTop = 300
  fireEvent.click(trigger)
  const panel = screen.getByRole('dialog', { name: '課題1を提出' })
  expect(content.scrollTop).toBe(300)
  fireEvent.change(within(panel).getByLabelText('提出ファイル'), { target: { files: [new File(['code'], 'main.c')] } })
  await within(panel).findByRole('button', { name: 'main.c を削除' })
  fireEvent.click(within(panel).getByRole('button', { name: '提出パネルを閉じる' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  fireEvent.click(trigger)
  expect(screen.getByRole('button', { name: 'main.c を削除' })).toBeDefined()

  await act(async () => {
    fireEvent.pointerDown(content)
    content.focus()
  })
  expect(screen.getByRole('dialog', { name: '課題1を提出' })).toBeDefined()
  await act(async () => { fireEvent.click(screen.getByRole('link', { name: '発展課題' })) })
  expect(router.state.location.pathname).toBe('/projects/project-1/ex1-2')
  expect(screen.getByRole('button', { name: 'main.c を削除' })).toBeDefined()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(trigger))

  fireEvent.click(trigger)
  await act(async () => { await router.navigate('/projects/project-2') })
  await screen.findByRole('heading', { name: '課題2-1' })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '課題を提出' }))
  expect(screen.getByRole('dialog', { name: '課題2を提出' })).toBeDefined()
  expect(screen.queryByRole('list', { name: '選択したファイル' })).toBeNull()
  expect(screen.getByRole('button', { name: '提出する' })).toHaveProperty('disabled', true)
})

test('Workflow name links scroll to the card without resetting the sidebar or outline', async () => {
  const { router } = setup()
  await screen.findByRole('heading', { level: 1, name: '基本課題' })
  const content = screen.getByRole('region', { name: '課題本文' })
  const sidebar = screen.getByRole('complementary', { name: '課題ナビゲーション' })
  content.scrollTop = 300
  sidebar.scrollTop = 100
  const card = document.getElementById('workflow-ex1-2')!
  const scroll = vi.spyOn(card, 'scrollIntoView')
  const link = within(sidebar).getByRole('link', { name: '発展課題' })
  await act(async () => { fireEvent.click(link) })
  expect(router.state.location.pathname).toBe('/projects/project-1/ex1-2')
  expect(scroll).toHaveBeenCalledTimes(1)
  expect(document.activeElement).toBe(card)
  expect(sidebar.scrollTop).toBe(100)
  expect(screen.getByRole('button', { name: '基本課題の目次を開閉' }).getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('button', { name: '発展課題の目次を開閉' }).getAttribute('aria-expanded')).toBe('false')
  await act(async () => { fireEvent.click(link) })
  expect(scroll).toHaveBeenCalledTimes(2)
  await act(async () => { await router.navigate(-1) })
  expect(content.scrollTop).toBe(0)
})

test('outlines open independently and heading links target the correct Workflow without closing outlines', async () => {
  const { router } = setup('/projects/project-1', async () => Response.json({ ...project,
    workflows: project.workflows.map(item => ({ ...item, description_markdown: '## 入力\n本文' })),
  }))
  await screen.findByRole('heading', { level: 1, name: '基本課題' })
  const outline = within(screen.getByRole('navigation', { name: '課題の目次' }))
  const first = outline.getByRole('button', { name: '基本課題の目次を開閉' })
  const second = outline.getByRole('button', { name: '発展課題の目次を開閉' })
  const content = screen.getByRole('region', { name: '課題本文' })
  content.scrollTop = 300
  fireEvent.click(second)
  expect(first.getAttribute('aria-expanded')).toBe('true')
  expect(second.getAttribute('aria-expanded')).toBe('true')
  expect(content.scrollTop).toBe(300)
  const links = outline.getAllByRole('link', { name: '入力' })
  expect(links[0].getAttribute('href')).not.toBe(links[1].getAttribute('href'))
  for (const [index, link] of links.entries()) {
    const target = document.getElementById(link.getAttribute('href')!.split('#')[1])!
    expect(target.closest('article')?.id).toBe(`workflow-${project.workflows[index].id}`)
    const scroll = vi.spyOn(target, 'scrollIntoView')
    await act(async () => { fireEvent.click(outline.getAllByRole('link', { name: '入力' })[index]) })
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(target)
  }
  expect(first.getAttribute('aria-expanded')).toBe('true')
  expect(second.getAttribute('aria-expanded')).toBe('true')
  await act(async () => { await router.navigate(-1) })
  expect(document.activeElement?.id).toBe('workflow-ex1-1-section-0')
  fireEvent.click(first)
  expect(second.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(second)
  expect(outline.queryAllByRole('link', { name: '入力' })).toHaveLength(0)
  expect(within(content).getAllByRole('article')).toHaveLength(2)
  expect(within(content).getAllByText('本文')).toHaveLength(2)
})

test.each([404, 500])('detail failure (%s) shows an error without retry or content', async (status) => {
  setup('/projects/project-1', async () => Response.json({ code: status, message: 'Unavailable' }, { status }))
  expect((await screen.findByRole('alert')).textContent).toBe(status === 404
    ? '課題が見つからないか、公開されていません。'
    : '課題を取得できませんでした。')
  expect(screen.queryByRole('button', { name: '再読み込み' })).toBeNull()
  expect(screen.queryByRole('region', { name: '課題本文' })).toBeNull()
})

test('detail omits empty required files', async () => {
  setup('/projects/project-1', async () => Response.json({ ...project, required_files: [] }))
  await screen.findByRole('heading', { level: 1, name: '基本課題' })
  fireEvent.click(screen.getByRole('button', { name: '課題を提出' }))
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
    ['基本課題', '課題', '次の課題'],
    ['最初の節'],
    ['テスト main.c', '具体例', '提出方法'],
    ['入力', '出力'],
    ['詳細'],
  ])
  expect(outline.querySelector('a a')).toBeNull()
  for (const link of outline.querySelectorAll('a[href*="#workflow-"]')) {
    expect(document.getElementById(link.getAttribute('href')!.split('#')[1])?.textContent).toBe(link.textContent)
  }
})

test('detail omits an unspecified Project description', async () => {
  setup('/projects/project-1', async () => Response.json({ ...project, description: '' }))
  expect(await screen.findByRole('combobox', { name: '課題を選択' })).toHaveProperty('textContent', project.name)
  expect(screen.queryByText(project.description)).toBeNull()
})

test('sidebar switches Projects and follows browser history', async () => {
  const { router } = setup('/projects/project-1/ex1-2')
  const sidebar = within(await screen.findByRole('complementary', { name: '課題ナビゲーション' }))
  const select = sidebar.getByRole('combobox', { name: '課題を選択' })
  fireEvent.keyDown(select, { key: 'ArrowDown' })
  await screen.findByRole('option', { name: '課題2' })
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['課題1', '課題2'])
  expect(screen.queryByRole('link', { name: 'Problem List' })).toBeNull()
  fireEvent.click(screen.getByRole('option', { name: '課題2' }))
  expect(await screen.findByRole('heading', { level: 1, name: '課題2-1' })).toBeDefined()
  expect(router.state.location.pathname).toBe('/projects/project-2')
  expect(screen.getByRole('combobox', { name: '課題を選択' })).toHaveProperty('textContent', '課題2')
  expect(screen.getByText('連結リスト')).toBeDefined()
  await act(async () => { await router.navigate(-1) })
  expect(await screen.findByRole('heading', { level: 1, name: '発展課題' })).toBeDefined()
  expect(screen.getByRole('combobox', { name: '課題を選択' })).toHaveProperty('textContent', project.name)
})

test('Project list failure shows an error without rendering detail', async () => {
  setup('/projects/project-1', async () => Response.json(project), async () =>
    Response.json({ message: 'Unavailable' }, { status: 500 }))
  expect((await screen.findByRole('alert')).textContent).toBe('課題を取得できませんでした。')
  expect(screen.queryByRole('region', { name: '課題本文' })).toBeNull()
  expect(screen.queryByRole('button', { name: /再読み込み/ })).toBeNull()
})

test.each(['list', 'detail'])('waits for the %s before rendering detail', async (pending) => {
  let resolve!: (response: Response) => void
  const response = new Promise<Response>(done => { resolve = done })
  setup('/projects/project-1',
    () => pending === 'detail' ? response : Promise.resolve(Response.json(project)),
    () => pending === 'list' ? response : Promise.resolve(Response.json({ projects: [project] })))
  expect(await screen.findByRole('status')).toHaveProperty('textContent', '読み込み中…')
  expect(screen.queryByRole('region', { name: '課題本文' })).toBeNull()
  await act(async () => { resolve(Response.json(pending === 'detail' ? project : { projects: [project] })) })
  expect(await screen.findByRole('heading', { level: 1, name: '基本課題' })).toBeDefined()
})
