import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const admin = {
  id: '00000000-0000-0000-0000-000000000001',
  userid: 'admin',
  name: 'Development Admin',
  role: 'admin',
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function renderApp(path: string, authenticated: boolean) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input)
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname === '/api/me') {
      return authenticated ? response(admin) : response({ error: { code: 'unauthorized', message: 'Authentication is required.' } }, 401)
    }
    if (url.pathname === '/api/admin/users') return response({ users: [] })
    if (url.pathname === '/api/session' && request.method === 'POST') return response(admin)
    if (url.pathname === '/api/session' && request.method === 'DELETE') return new Response(null, { status: 204 })
    throw new Error(`unexpected request: ${request.method} ${url.pathname}`)
  }))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
    </QueryClientProvider>,
  )
}

test('unauthenticated visitors are redirected to login', async () => {
  renderApp('/private', false)
  expect(await screen.findByRole('button', { name: 'Log in' })).toBeDefined()
  expect(screen.queryByRole('banner')).toBeNull()
})

test('login navigates to the protected home page', async () => {
  renderApp('/login', false)
  fireEvent.change(await screen.findByLabelText('User ID'), { target: { value: 'admin' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'admin' } })
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
  expect(await screen.findByText('Development Admin')).toBeDefined()
  expect(screen.getByText('admin')).toBeDefined()
})

test('authenticated visitors see a 404 for unknown routes', async () => {
  renderApp('/unknown', true)
  expect(await screen.findByRole('heading', { name: '404' })).toBeDefined()
})

test('authenticated visitors are redirected away from login', async () => {
  renderApp('/login', true)
  expect(await screen.findByText('Development Admin')).toBeDefined()
})

test('logout returns to login', async () => {
  renderApp('/', true)
  fireEvent.click(await screen.findByRole('button', { name: 'Logout' }))
  expect(await screen.findByRole('button', { name: 'Log in' })).toBeDefined()
  expect(screen.queryByRole('banner')).toBeNull()
})

test.each(['/', '/admin/users', '/unknown'])('authenticated page %s has a shared top bar with a home link', async (path) => {
  renderApp(path, true)
  const header = await screen.findByRole('banner')
  expect(within(header).getByRole('button', { name: 'Logout' })).toBeDefined()
  fireEvent.click(within(header).getByRole('link', { name: 'DSA' }))
  expect(await screen.findByText('Development Admin')).toBeDefined()
})

test('logout prevents duplicate requests while pending and allows retry after failure', async () => {
  renderApp('/admin/users', true)
  const logout = await screen.findByRole('button', { name: 'Logout' })
  await screen.findByText('No matching User Accounts.')
  let finishLogout: (response: Response) => void = () => { throw new Error('Logout has not started') }
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { finishLogout = resolve }))
  fireEvent.click(logout)
  await waitFor(() => expect(logout).toHaveProperty('disabled', true))
  const requestCount = vi.mocked(fetch).mock.calls.length
  fireEvent.click(logout)
  expect(vi.mocked(fetch).mock.calls).toHaveLength(requestCount)
  finishLogout(response({ error: { code: 'internal_error', message: 'Unavailable' } }, 500))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Unable to log out. Please try again.')
  expect(logout).toHaveProperty('disabled', false)
  expect(screen.getByRole('heading', { name: 'User Accounts' })).toBeDefined()
  fireEvent.click(logout)
  expect(await screen.findByRole('button', { name: 'Log in' })).toBeDefined()
  expect(screen.queryByRole('banner')).toBeNull()
})
