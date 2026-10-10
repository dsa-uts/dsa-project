import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { components } from '@/api/schema'
import App from './App'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const project: components['schemas']['Project'] = {
  id: 'project-1', resource_id: 'ex1', name: '課題1', description: 'C言語によるプログラミングの復習', latest_version_id: 'version-2', latest_version: 'v2.0.0',
  display_order: 0, published_at: null, deadline: null,
  workflows: [{ id: 'new', name: '最新版の問題' }],
}
const secondProject = { ...project, id: 'project-2', name: '課題2', description: '' }

function setup(list = async () => Response.json({ projects: [project, secondProject] })) {
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

test('filters fetched Projects without navigation', async () => {
  const { fetchList, router } = setup()
  await screen.findByRole('heading', { name: '課題1' })
  expect(screen.getByRole('tab', { name: '課題1' })).toBeDefined()
  expect(within(screen.getByRole('region', { name: '課題1' })).getByText(project.description)).toBeDefined()
  expect(within(screen.getByRole('region', { name: '課題2' })).queryByText(project.description)).toBeNull()
  fireEvent.mouseDown(screen.getByRole('tab', { name: '課題2' }), { button: 0, ctrlKey: false })
  expect(screen.queryByRole('heading', { name: '課題1' })).toBeNull()
  expect(screen.getByRole('heading', { name: '課題2' })).toBeDefined()
  expect(router.state.location.pathname).toBe('/projects')
  fireEvent.keyDown(screen.getByRole('tab', { name: 'All' }), { key: 'Enter' })
  expect(screen.getByRole('heading', { name: '課題1' })).toBeDefined()
  expect(fetchList).toHaveBeenCalledTimes(1)
})

test('a failed list load can be retried and an empty list is explicit', async () => {
  let fails = true
  setup(async () => fails ? Response.json({ message: 'Unavailable' }, { status: 500 }) : Response.json({ projects: [] }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('課題一覧を取得できませんでした。'))
  fails = false
  fireEvent.click(screen.getByRole('button', { name: '再読み込み' }))
  expect(await screen.findByText('表示できる課題はありません。')).toBeDefined()
  expect(screen.queryByRole('alert')).toBeNull()
})
