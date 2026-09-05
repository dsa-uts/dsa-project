import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
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
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/admin/users']}><App /></MemoryRouter></QueryClientProvider>)
}

test('creation keeps duplicate and server validation errors in the dialog', async () => {
  renderAdmin()
  fireEvent.click(await screen.findByRole('button', { name: 'Create user' }))
  fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'taken' } })
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'New user' } })
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'password' } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect(await screen.findByText('This User ID is already taken.')).toBeDefined()
  expect(screen.getByRole('dialog')).toBeDefined()
  fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'new-user' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Rejected by server.')
  expect(screen.getByRole('dialog')).toBeDefined()
})


test.each([
  ['User ID', '_invalid', 'Use 1–30 letters, digits, dots, underscores or hyphens, starting with a letter or digit.'],
  ['User ID', 'u'.repeat(31), 'Use 1–30 letters, digits, dots, underscores or hyphens, starting with a letter or digit.'],
  ['Display name', '　 ', 'Use 1–64 characters, with no control characters or whitespace-only name.'],
  ['Display name', '🔑'.repeat(65), 'Use 1–64 characters, with no control characters or whitespace-only name.'],
  ['Password', '🔑'.repeat(7), 'Use 8–256 characters.'],
  ['Password', '🔑'.repeat(257), 'Use 8–256 characters.'],
])('creation shows a field error for invalid %s (%s)', async (label, value, message) => {
  renderAdmin()
  fireEvent.click(await screen.findByRole('button', { name: 'Create user' }))
  fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'valid-user' } })
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Valid user' } })
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'password' } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password' } })
  fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect(await screen.findByText(message)).toBeDefined()
  expect(screen.getByLabelText(label, { exact: true }).getAttribute('aria-invalid')).toBe('true')
})
