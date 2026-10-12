import type { SubmissionFile } from './validation-files'

export function selectedFiles(files: FileList | File[]): SubmissionFile[] {
  return Array.from(files, file => ({ path: file.webkitRelativePath || file.name, content: file }))
}

export async function droppedFiles(data: DataTransfer): Promise<SubmissionFile[]> {
  // drop イベント終了後はデータを取得できないため、await より前に全エントリーを確保する。
  const items = Array.from(data.items ?? []).filter(item => item.kind === 'file')
  if (!items.length) return selectedFiles(data.files)
  const entries = items.map(item => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }))
  const files: SubmissionFile[] = []
  const visit = async (entry: FileSystemEntry, parent: string): Promise<void> => {
    const path = parent + entry.name
    if (entry.isFile) {
      const content = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      files.push({ path, content })
      if (files.length > 50) throw new Error('提出できるのは50ファイル、合計20 MBまでです。')
      return
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // 内容は分割して返されるため、空になるまで同じ reader で読み続ける。
    while (true) {
      const children = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (!children.length) break
      for (const child of children) await visit(child, `${path}/`)
    }
  }
  for (const { entry, file } of entries) {
    if (entry) await visit(entry, '')
    else if (file) files.push({ path: file.name, content: file })
    else throw new Error('読み込めない項目があります。フォルダはZIPにまとめて追加してください。')
  }
  if (!files.length) throw new Error('フォルダにファイルがありません。')
  return files
}
