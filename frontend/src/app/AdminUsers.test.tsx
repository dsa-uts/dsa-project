import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import App from './App'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function renderAdmin() {
  vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname
    let body: unknown = { id: '00000000-0000-0000-0000-000000000001', userid: 'admin', name: 'Admin', role: 'admin' }
    let status = 200
    if (path === '/api/admin/users') {
      if (request.method === 'GET') body = { users: [] }
      else {
        const data = await request.json()
        status = data.userid === 'taken' ? 409 : 422
        body = { error: { code: status === 409 ? 'userid_taken' : 'validation_failed', message: 'Rejected by server.' } }
      }
    }
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }))
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: ['/admin/users'] })} /></QueryClientProvider>)
}

test('creation keeps duplicate and server validation errors in the dialog', async () => {
  renderAdmin()
  fireEvent.click(await screen.findByRole('button', { name: 'Create user' }))
  fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'taken' } })
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'New user' } })
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'password' } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(screen.getByLabelText('User ID').getAttribute('aria-invalid')).toBe('true'))
  expect(screen.getByRole('dialog')).toBeDefined()
  fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'new-user' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect(await screen.findByRole('alert')).toBeDefined()
  expect(screen.getByRole('dialog')).toBeDefined()
})


test.each([
  ['User ID', '_invalid'],
  ['User ID', 'u'.repeat(31)],
  ['Display name', '　 '],
  ['Display name', '🔑'.repeat(65)],
  ['Password', '🔑'.repeat(7)],
  ['Password', '🔑'.repeat(257)],
])('creation shows a field error for invalid %s (%s)', async (label, value) => {
  renderAdmin()
  fireEvent.click(await screen.findByRole('button', { name: 'Create user' }))
  fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'valid-user' } })
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Valid user' } })
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'password' } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password' } })
  fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect(screen.getByLabelText(label, { exact: true }).getAttribute('aria-invalid')).toBe('true')
})
