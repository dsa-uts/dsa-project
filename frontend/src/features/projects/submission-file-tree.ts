import type { SubmissionFile } from './validation-files'

export type FileNode = {
  name: string
  children: string[]
  // 空ファイル（0 bytes）と区別するため、フォルダは size を持たない。
  size?: number
}

// 正規化・衝突検証済みの提出パスから、フォルダ優先・名前順の表示用ツリーを作る。
export function buildFileTree(files: SubmissionFile[]) {
  const nodes = new Map<string, FileNode>([
    ['/', { name: '', children: [] }],
  ])

  for (const file of files) {
    const parts = file.path.split('/')
    let parentPath = '/'

    for (const [index, name] of parts.entries()) {
      const path = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`
      const isFile = index === parts.length - 1

      if (!nodes.has(path)) {
        nodes.set(path, {
          name,
          children: [],
          size: isFile ? file.content.size : undefined,
        })
        nodes.get(parentPath)!.children.push(path)
      }

      parentPath = path
    }
  }

  for (const node of nodes.values()) {
    node.children.sort((leftPath, rightPath) => {
      const left = nodes.get(leftPath)!
      const right = nodes.get(rightPath)!
      const leftIsFolder = left.size === undefined
      const rightIsFolder = right.size === undefined

      if (leftIsFolder !== rightIsFolder) return leftIsFolder ? -1 : 1
      return left.name.localeCompare(right.name, 'ja', { numeric: true })
    })
  }
  return nodes
}
