import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from './App'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('backend の health check 結果を表示する', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )

  render(<App />)

  expect(await screen.findByText('ok')).toBeDefined()
  expect(vi.mocked(fetch)).toHaveBeenCalledWith('/health')
})

test('backend に到達できない場合は unreachable と表示する', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

  render(<App />)

  expect(await screen.findByText('unreachable')).toBeDefined()
})
