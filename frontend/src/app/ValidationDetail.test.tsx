import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { components } from '@/api/schema'
import { ValidationDetailPage } from '@/features/projects/ValidationDetailPage'
import { decodeOutput, decodeText, loadResultFiles } from '@/features/projects/validation-detail-files'
import { unzipSync } from 'fflate'

const step: components['schemas']['ValidationStep'] = {
  index: 0, name: '日本語の出力', run: "printf 'こんにちは'", compile: false, timeout_ms: 1000, stdin: '',
  expected: { exit_code: 0, stdout: { data: btoa('expected\n'), match: 'exact' }, stderr: { data: '', match: 'easy' } },
  status: 'WA', exit_code: 0, duration_ms: 0, memory_bytes: 0, stdout: { data: '44GT44KT44Gr44Gh44Gv', truncated: true }, stderr: { data: '', truncated: false },
}
const detail: components['schemas']['ValidationDetail'] = {
  id: 'request-1', submission_id: 'submission-1', project: { id: 'project-1', name: '課題1' }, subject_user: { id: 'student', userid: 's001', name: '提出者' },
  version: 'v1.0.0', content_hash: `sha256:${'a'.repeat(64)}`, state: 'completed', status: 'WA', duration_ms: 42, requested_at: '2026-10-04T00:00:00Z',
  result: { peak_memory_bytes: 0, workflows: [
    { id: 'basic', name: '基本課題', status: 'WA', duration_ms: 0, jobs: [{ id: 'test', name: 'test', status: 'WA', duration_ms: 0, peak_memory_bytes: 0, skip_reason: null, stop_reason: null, steps: [step, { ...step, index: 1, name: '未記録のStep', status: null, stdout: null, stderr: null, exit_code: null, duration_ms: null, memory_bytes: null, expected: { exit_code: null, stdout: null, stderr: null } }], artifacts: [{ name: 'plot', path: 'plot.png', content_type: 'image/png', status: 'OLE', available: false, size_bytes: null, error: 'サイズ上限を超えました。' }] }] },
    { id: 'extra', name: '発展課題', status: 'SKIP', duration_ms: null, jobs: [] },
  ] },
}
function filesResponse(kind: 'files' | 'artifacts') {
  const form = new FormData()
  form.set('metadata', JSON.stringify(kind === 'files' ? {
    submission_files: [{ part: 'file0', path: 'src/main.c' }, { part: 'file3', path: 'report.pdf' }],
    presets: [{ workflow_id: 'basic', files: [{ part: 'file1', path: 'test.c' }] }, { workflow_id: 'extra', files: [{ part: 'file2', path: 'extra.c' }] }],
  } : { files: [{ part: 'file0', path: 'summary.json', workflow_id: 'basic', job_id: 'test', name: 'summary', content_type: 'application/json' }] }))
  form.set('file0', new Blob([kind === 'files' ? 'int main() {}\n' : '{"passed": 1}']), 'ignored')
  form.set('file1', new Blob(['basic preset']), 'ignored')
  form.set('file2', new Blob(['extra preset']), 'ignored')
  form.set('file3', new Blob([new Uint8Array([0, 255, 10])]), 'ignored')
  return new Response(form)
}
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
function setup(handle = async () => Response.json(detail), path = '/results/request-1') {
  const fetchMock = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname
    if (path.endsWith('/files')) return filesResponse('files')
    if (path.endsWith('/artifacts')) return filesResponse('artifacts')
    return handle()
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  const router = createMemoryRouter([{ path: '/results/:requestId', element: <ValidationDetailPage /> }], { initialEntries: [path] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return { router, client, fetchMock }
}

test('pinned metadata, files, output expectations, missing results and Workflow navigation', async () => {
  const { router } = setup()
  await screen.findByText('int main() {}')
  expect(screen.getByText('(ver: v1.0.0)')).toBeDefined()
  expect(screen.getByText('a'.repeat(64))).toBeDefined()
  expect(screen.getByRole('link', { name: '課題説明に戻る' }).getAttribute('href')).toBe('/projects/project-1')
  expect(await screen.findByText('basic preset')).toBeDefined()
  expect(await screen.findByText('{"passed": 1}')).toBeDefined()
  expect(screen.getByText('サイズ上限を超えました。')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '日本語の出力 の詳細' }))
  expect(screen.getByText('こんにちは')).toBeDefined()
  expect(screen.getByText('出力は上限で切り詰められています。')).toBeDefined()
  expect(screen.getByText('Exit code: 0 (expected: 0)')).toBeDefined()
  expect(screen.getAllByText('(空の出力)')).toHaveLength(2)
  fireEvent.click(screen.getAllByRole('button', { name: 'Diff View' })[0])
  expect(screen.getByText('− こんにちは')).toBeDefined()
  expect(screen.getByText('+ expected')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '未記録のStep の詳細' }))
  expect(screen.getByText('実行結果が記録されていません。未実行とは限りません。')).toBeDefined()
  expect(screen.getAllByText('指定なし（比較しません）')).toHaveLength(2)
  fireEvent.click(screen.getByRole('link', { name: '発展課題 SKIP' }))
  expect(router.state.location.search).toBe('?workflow=extra')
  await screen.findByText('extra preset')
  expect(screen.queryByText('basic preset')).toBeNull()
  expect(screen.queryByText('{"passed": 1}')).toBeNull()
  await act(async () => router.navigate(-1))
  await screen.findByText('basic preset')
})

test('polls unfinished Requests, waits for completion to fetch Artifacts, and stops polling', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  let complete = false
  const { fetchMock } = setup(async () => Response.json(complete ? detail : { ...detail, state: 'retrying', status: null, result: null, duration_ms: null }))
  await screen.findByText('再試行中です。結果は5秒ごとに更新されます。')
  await screen.findByText('int main() {}')
  expect(fetchMock.mock.calls.some(([request]) => request.url.endsWith('/artifacts'))).toBe(false)
  complete = true
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  await screen.findByText('{"passed": 1}')
  const count = fetchMock.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(fetchMock).toHaveBeenCalledTimes(count)
})

test('404 hides detail and file endpoints; retry recovers and honors the requested Workflow', async () => {
  let fail = true
  const { fetchMock } = setup(async () => fail ? Response.json({ code: 404, message: 'missing' }, { status: 404 }) : Response.json(detail), '/results/request-1?workflow=extra')
  expect((await screen.findByRole('alert')).textContent).toContain('閲覧できません')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  fail = false
  fireEvent.click(screen.getByRole('button', { name: '再読み込み' }))
  await screen.findByText('extra preset')
  expect(screen.queryByText('basic preset')).toBeNull()
})

test('file failures can be retried independently and ZIP download preserves paths and bytes', async () => {
  const { fetchMock } = setup()
  fetchMock.mockImplementation(async (request: Request) => request.url.endsWith('/files') ? new Response('', { status: 500 }) : request.url.endsWith('/artifacts') ? filesResponse('artifacts') : Response.json(detail))
  const submission = within(await screen.findByRole('region', { name: '提出ファイル' }))
  await submission.findByRole('alert')
  expect(screen.getByText('実行完了')).toBeDefined()
  fetchMock.mockImplementation(async (request: Request) => request.url.endsWith('/files') ? filesResponse('files') : Response.json(detail))
  fireEvent.click(submission.getByRole('button', { name: 'ファイルを再読み込み' }))
  await submission.findByText('int main() {}')
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  fireEvent.click(submission.getByRole('button', { name: '一括ダウンロード' }))
  await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled())
  const archive = vi.mocked(URL.createObjectURL).mock.calls.map(([blob]) => blob).find(blob => blob instanceof Blob && blob.type === 'application/zip')
  expect(archive).toBeInstanceOf(Blob)
  if (!(archive instanceof Blob)) throw new Error('missing ZIP')
  const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()))
  expect(new TextDecoder().decode(entries['src/main.c'])).toBe('int main() {}\n')
  expect(entries['report.pdf']).toEqual(new Uint8Array([0, 255, 10]))
})

test('binary output remains identifiable and invalid multipart responses fail', async () => {
  expect(decodeOutput('44GT44KT44Gr44Gh44Gv')).toBe('こんにちは')
  expect(decodeText(new Uint8Array([255]))).toBeNull()
  expect(decodeOutput('AP8=')).toBe('バイナリ出力 (Base64): AP8=')
  vi.stubGlobal('fetch', async () => { const form = new FormData(); form.set('metadata', JSON.stringify({ submission_files: [{ part: 'missing', path: 'a' }], presets: [] })); return new Response(form) })
  await expect(loadResultFiles('request-1', 'files', new AbortController().signal)).rejects.toThrow('ファイルの内容がありません')
})
