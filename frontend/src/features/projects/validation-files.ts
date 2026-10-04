import { unzipSync } from 'fflate'

export type SubmissionFile = { path: string; content: Blob }
const maxBytes = 20_000_000

function normalizePath(name: string) {
  const slashed = name.replaceAll('\\', '/')
  if (slashed.includes('\0') || slashed[1] === ':') throw new Error(`無効なパスです: ${name}`)
  const parts: string[] = []
  for (const part of slashed.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  if (!parts.length) throw new Error(`無効なパスです: ${name}`)
  return parts.join('/')
}

// Validate ZIP entries before extraction too: unzip's object result cannot retain duplicate names.
export async function prepareFiles(selected: File[], existing: SubmissionFile[] = []): Promise<SubmissionFile[]> {
  const files = [...existing]
  const paths = existing.map(file => file.path)
  let bytes = existing.reduce((sum, file) => sum + file.content.size, 0)
  const reserve = (name: string, size: number) => {
    const path = normalizePath(name)
    const conflict = paths.find(other => other === path || other.startsWith(`${path}/`) || path.startsWith(`${other}/`))
    if (conflict) throw new Error(`パスが重複または衝突しています: ${path} / ${conflict}`)
    paths.push(path)
    bytes += size
    if (paths.length > 50 || bytes > maxBytes) throw new Error('提出できるのは50ファイル、合計20 MBまでです。')
    return path
  }
  for (const file of selected) {
    if (!/\.zip$/i.test(file.name)) {
      files.push({ path: reserve(file.webkitRelativePath || file.name, file.size), content: file })
      continue
    }
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter(entry) {
        if (entry.name.replaceAll('\\', '/').endsWith('/')) return false
        reserve(entry.name, entry.originalSize)
        return true
      },
    })
    for (const [name, content] of Object.entries(entries)) {
      files.push({ path: normalizePath(name), content: new Blob([new Uint8Array(content)]) })
    }
  }
  if (!files.length) throw new Error('提出するファイルを選択してください。')
  if (files.reduce((sum, file) => sum + file.content.size, 0) > maxBytes) throw new Error('提出できるのは50ファイル、合計20 MBまでです。')
  return files
}

export function submissionBody(files: SubmissionFile[]) {
  const metadata = { files: files.map((file, index) => ({ part: `file${index}`, path: file.path })) }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  files.forEach((file, index) => form.append(`file${index}`, file.content, 'file'))
  return { metadata, form }
}
