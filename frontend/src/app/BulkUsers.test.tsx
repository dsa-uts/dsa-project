import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { components } from '@/api/schema'
import App from './App'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('Apply preflights all rows, continues failures, retains passwords and exports cumulative CSV in row order', async () => {
  const created: components['schemas']['CreateUserAccountRequest'][] = []
  const blobs: Blob[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { if (blob instanceof Blob) blobs.push(blob); return 'blob:test' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname
    let body: unknown = { id: '00000000-0000-0000-0000-000000000001', userid: 'admin', name: 'Admin', role: 'admin' }
    let status = 200
    if (path === '/api/admin/users' && request.method === 'POST') {
      const data: components['schemas']['CreateUserAccountRequest'] = await request.json()
      created.push(data)
      status = data.userid === 'taken' ? 409 : 201
      body = status === 409 ? { error: { code: 'userid_taken', message: 'Already taken.' } } : { ...data, id: crypto.randomUUID(), disabled: false }
    } else if (path === '/api/admin/users') body = { users: [] }
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }))
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: ['/admin/users/bulk'] })} /></QueryClientProvider>)
  const table = await screen.findByLabelText('一括作成の表にセルを貼り付け')
  fireEvent.paste(table, { clipboardData: { getData: () => 'first\tFirst\tstudent\t\ntaken\tSecond\twrong\t\nthird\tThird\tmanager\tmanual-password' } })
  const password = screen.getByLabelText('2行目 password')
  const generated = (password as HTMLInputElement).value
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'role は student または manager にしてください。')
  expect(created).toHaveLength(0)
  expect(blobs).toHaveLength(0)
  fireEvent.change(screen.getByLabelText('2行目 role'), { target: { value: 'student' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(await screen.findByText('作成済み 2 / 3 件')).toBeDefined()
  expect(created.map((row) => row.userid)).toEqual(['first', 'taken', 'third'])
  expect(screen.getByLabelText('1行目 userid')).toHaveProperty('disabled', true)
  expect(password).toHaveProperty('value', generated)
  const firstCSV = await blobs[0].text()
  expect(firstCSV).toContain('\r\n,,,\r\nthird,Third,manager,manual-password\r\n')
  fireEvent.change(screen.getByLabelText('2行目 userid'), { target: { value: 'second' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(await screen.findByText('作成済み 3 / 3 件')).toBeDefined()
  expect(created.map((row) => row.userid)).toEqual(['first', 'taken', 'third', 'second'])
  expect(created[3].password).toBe(generated)
  expect(await blobs[1].text()).toContain(`second,Second,student,${generated}\r\nthird,Third,manager,manual-password`)
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
  fireEvent.click(screen.getByRole('link', { name: 'User Accounts' }))
  expect(await screen.findByRole('dialog')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '戻る' }))
  expect(screen.getByLabelText('2行目 password')).toHaveProperty('value', generated)
  fireEvent.click(screen.getByRole('link', { name: 'User Accounts' }))
  fireEvent.click(await screen.findByRole('button', { name: '離れる' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'ユーザーを一括作成' })).toBeNull())
  fireEvent.click(await screen.findByRole('link', { name: '一括作成' }))
  expect(await screen.findByText(/ここを選択してセル/)).toBeDefined()
})
