import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// main.tsx と同じ Provider 構成。retry を切って失敗ケースを即座に観測する。
function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface GreetingRow {
  id: string
  message: string
  created_at: string
}

// /health (raw fetch) と /api/hello (openapi-fetch 経由) の両方を
// URL で振り分けるスタブ。openapi-fetch は Request オブジェクトで呼ぶ。
function stubFetchRoutes(greetings: GreetingRow[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      const url = new URL(request.url, 'http://localhost')
      if (url.pathname === '/health') {
        return jsonResponse({ status: 'ok' })
      }
      if (url.pathname === '/api/hello' && request.method === 'GET') {
        return jsonResponse({ greetings: [...greetings].reverse() })
      }
      if (url.pathname === '/api/hello' && request.method === 'POST') {
        const body = (await request.json()) as { name: string }
        const created: GreetingRow = {
          id: `00000000-0000-0000-0000-00000000000${greetings.length + 1}`,
          message: `hello, ${body.name}`,
          created_at: '2026-08-01T00:00:00Z',
        }
        greetings.push(created)
        return jsonResponse(created, 201)
      }
      throw new Error(`unexpected request: ${request.method} ${url.pathname}`)
    }),
  )
}

test('backend の health check 結果を表示する', async () => {
  stubFetchRoutes([])

  renderApp()

  expect(await screen.findByText('ok')).toBeDefined()
})

test('backend に到達できない場合は unreachable と表示する', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

  renderApp()

  expect(await screen.findByText('unreachable')).toBeDefined()
  expect(await screen.findByText('failed to load greetings')).toBeDefined()
})

test('保存済みの greeting を一覧表示する', async () => {
  stubFetchRoutes([
    {
      id: '00000000-0000-0000-0000-000000000001',
      message: 'hello, dsa',
      created_at: '2026-08-01T00:00:00Z',
    },
  ])

  renderApp()

  expect(await screen.findByText('hello, dsa')).toBeDefined()
})

test('name を送信すると greeting が作成され一覧が更新される', async () => {
  stubFetchRoutes([])

  renderApp()

  expect(await screen.findByText('no greetings yet')).toBeDefined()

  fireEvent.change(screen.getByLabelText('name'), { target: { value: 'dsa' } })
  fireEvent.click(screen.getByRole('button', { name: 'Greet' }))

  expect(await screen.findByText('hello, dsa')).toBeDefined()
})
