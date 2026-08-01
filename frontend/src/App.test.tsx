import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import App from './App'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// main.tsx と同じ Provider 構成 (Router はテストでは MemoryRouter)。
// retry を切って失敗ケースを即座に観測する。
function renderApp(path = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const adminUser = {
  id: '00000000-0000-0000-0000-000000000001',
  userid: 'admin',
  name: '管理者',
  role: 'admin',
}

// /health (raw fetch) と Auth API (openapi-fetch 経由) を URL で振り分けるスタブ。
// セッション状態を closure に持ち、login/logout で切り替える。
function stubAuthRoutes({ loggedIn = false } = {}) {
  let sessionActive = loggedIn
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      const url = new URL(request.url, 'http://localhost')
      if (url.pathname === '/health') {
        return jsonResponse({ status: 'ok' })
      }
      if (url.pathname === '/api/session' && request.method === 'POST') {
        const body = (await request.json()) as { userid: string; password: string }
        if (body.userid === adminUser.userid && body.password === 'password') {
          sessionActive = true
          return jsonResponse(adminUser)
        }
        return jsonResponse(
          { error: { code: 'invalid_credentials', message: 'invalid userid or password' } },
          401,
        )
      }
      if (url.pathname === '/api/session' && request.method === 'DELETE') {
        sessionActive = false
        return new Response(null, { status: 204 })
      }
      if (url.pathname === '/api/me' && request.method === 'GET') {
        if (sessionActive) {
          return jsonResponse(adminUser)
        }
        return jsonResponse(
          { error: { code: 'unauthenticated', message: 'no valid session' } },
          401,
        )
      }
      throw new Error(`unexpected request: ${request.method} ${url.pathname}`)
    }),
  )
}

test('未認証で保護ページを開くとログインページへリダイレクトする', async () => {
  stubAuthRoutes({ loggedIn: false })

  renderApp('/')

  expect(await screen.findByLabelText('ユーザーID')).toBeDefined()
})

test('未認証で未知のパスを開いてもログインページへリダイレクトする', async () => {
  stubAuthRoutes({ loggedIn: false })

  renderApp('/no-such-page')

  expect(await screen.findByLabelText('ユーザーID')).toBeDefined()
})

test('ログイン成功でホームへ遷移し name と Role が表示される', async () => {
  stubAuthRoutes({ loggedIn: false })

  renderApp('/login')

  fireEvent.change(screen.getByLabelText('ユーザーID'), { target: { value: 'admin' } })
  fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'password' } })
  fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

  expect(await screen.findByText('管理者')).toBeDefined()
  expect(screen.getByText('admin')).toBeDefined()
  expect(screen.getByRole('button', { name: 'ログアウト' })).toBeDefined()
})

test('ログイン失敗でエラーメッセージを表示する', async () => {
  stubAuthRoutes({ loggedIn: false })

  renderApp('/login')

  fireEvent.change(screen.getByLabelText('ユーザーID'), { target: { value: 'admin' } })
  fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'wrong' } })
  fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

  expect(
    await screen.findByText('ユーザーIDまたはパスワードが正しくありません'),
  ).toBeDefined()
})

test('ログアウトするとログインページへ遷移する', async () => {
  stubAuthRoutes({ loggedIn: true })

  renderApp('/')

  fireEvent.click(await screen.findByRole('button', { name: 'ログアウト' }))

  expect(await screen.findByLabelText('ユーザーID')).toBeDefined()
})

test('認証済みならホームで backend の health check 結果を表示する', async () => {
  stubAuthRoutes({ loggedIn: true })

  renderApp('/')

  expect(await screen.findByText('ok')).toBeDefined()
})
