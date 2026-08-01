// openapi.yaml から生成された型 (schema.d.ts) に基づく typed API client。
// fetch 層 (openapi-fetch) と TanStack Query 層 (openapi-react-query) の 2 段構え。
import createFetchClient from 'openapi-fetch'
import createClient from 'openapi-react-query'
import type { paths } from './schema'

export const fetchClient = createFetchClient<paths>({
  baseUrl: '/',
  // openapi-fetch は client 生成時に fetch を束縛するため、テストの
  // vi.stubGlobal('fetch', ...) が効くよう呼び出し時に解決させる。
  fetch: (request) => globalThis.fetch(request),
})

// コンポーネントからは $api.useQuery('get', '/api/hello') のように使う。
export const $api = createClient(fetchClient)
