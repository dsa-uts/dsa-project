import { fetchClient } from '@/api/client'
import type { components } from '@/api/schema'

type FilePart = components['schemas']['FilePart']
export type ResultFile = FilePart & { content: Blob; text: string | null; workflowId?: string; jobId?: string; name?: string; contentType?: string }
export type ResultFiles = { submission: ResultFile[]; presets: ResultFile[]; artifacts: ResultFile[] }

export function decodeText(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return bytes.some(byte => (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) || byte === 127) ? null : text
  } catch { return null }
}

export function decodeOutput(data: string): string {
  const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0))
  return decodeText(bytes) ?? `バイナリ出力 (Base64): ${data}`
}

export async function loadResultFiles(requestId: string, kind: 'files' | 'artifacts', signal: AbortSignal): Promise<ResultFiles> {
  const { response, error } = await fetchClient.GET(kind === 'files' ? '/api/requests/{request_id}/validation/files' : '/api/requests/{request_id}/validation/artifacts', {
    params: { path: { request_id: requestId } }, parseAs: 'stream', signal,
  })
  if (error || !response.ok) throw new Error('ファイルを取得できませんでした。')
  const form = await response.formData()
  const raw = form.get('metadata')
  if (typeof raw !== 'string') throw new Error('ファイル情報が不正です。')
  const metadata = JSON.parse(raw)
  const read = async (entry: FilePart): Promise<ResultFile> => {
    if (!entry || typeof entry.part !== 'string' || typeof entry.path !== 'string') throw new Error('ファイル情報が不正です。')
    const content = form.get(entry.part)
    if (!content || typeof content === 'string') throw new Error('ファイルの内容がありません。')
    return { ...entry, content, text: decodeText(new Uint8Array(await content.arrayBuffer())) }
  }
  const result: ResultFiles = { submission: [], presets: [], artifacts: [] }
  if (kind === 'files') {
    if (!Array.isArray(metadata?.submission_files) || !Array.isArray(metadata?.presets)) throw new Error('ファイル情報が不正です。')
    result.submission = await Promise.all(metadata.submission_files.map(read))
    for (const group of metadata.presets as components['schemas']['PresetFiles'][]) {
      if (!group || typeof group.workflow_id !== 'string' || !Array.isArray(group.files)) throw new Error('プリセット情報が不正です。')
      result.presets.push(...await Promise.all(group.files.map(async entry => ({ ...await read(entry), workflowId: group.workflow_id }))))
    }
  } else {
    if (!Array.isArray(metadata?.files)) throw new Error('Artifact情報が不正です。')
    result.artifacts = await Promise.all((metadata.files as components['schemas']['ArtifactPart'][]).map(async entry => {
      if (!entry || [entry.workflow_id, entry.job_id, entry.name, entry.content_type].some(value => typeof value !== 'string')) throw new Error('Artifact情報が不正です。')
      return { ...await read(entry), workflowId: entry.workflow_id, jobId: entry.job_id, name: entry.name, contentType: entry.content_type }
    }))
  }
  return result
}
