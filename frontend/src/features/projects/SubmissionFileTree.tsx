import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react'
import { hotkeysCoreFeature, syncDataLoaderFeature, type ItemInstance } from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { ChevronRight, File, FileCode, FileText, Folder, FolderOpen, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { droppedFiles, selectedFiles } from './dropped-files'
import { buildFileTree, type FileNode } from './submission-file-tree'
import type { SubmissionFile } from './validation-files'

// ツリーIDの先頭の / を除き、提出パスへ戻す（ルートは空文字）。
function submissionPath(item: ItemInstance<FileNode>) {
  return item.getId().slice(1)
}

function dropDirectory(event: DragEvent<HTMLDivElement>) {
  const target = event.target instanceof Element
    ? event.target.closest('[data-drop-folder]') : null
  return target && event.currentTarget.contains(target)
    ? target.getAttribute('data-drop-folder') ?? '' : ''
}

function fileIcon(node: FileNode, expanded: boolean) {
  if (node.size === undefined) return expanded ? FolderOpen : Folder
  if (/\.(c|h|cpp|hpp|js|jsx|ts|tsx|py|go|java|rs)$/i.test(node.name)) return FileCode
  if (/\.(md|txt)$/i.test(node.name)) return FileText
  return File
}

function fileSize(bytes: number) {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

export function SubmissionFileTree({ files, busy, onAdd, onMove, onRemove }: {
  files: SubmissionFile[]
  busy: boolean
  // drop データを確保するため、受け付けた read はイベント内で同期的に呼び出す。
  onAdd: (read: () => Promise<SubmissionFile[]>, directory: string) => void
  onMove: (path: string, directory: string) => void
  onRemove: (path: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const draggedPath = useRef<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const nodes = useMemo(() => buildFileTree(files), [files])
  const tree = useTree<FileNode>({
    rootItemId: '/',
    getItemName: item => item.getItemData().name,
    isItemFolder: item => item.getItemData().size === undefined,
    dataLoader: {
      getItem: path => nodes.get(path)!,
      getChildren: path => nodes.get(path)?.children ?? [],
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  })

  // ファイル更新後の構造をキャッシュへ反映し、削除済みの行へのフォーカスを解除する。
  useEffect(() => {
    const state = tree.getState()
    tree.setConfig(config => ({
      ...config, state: {
        ...state,
        focusedItem: state.focusedItem && nodes.has(state.focusedItem) ? state.focusedItem : null,
        expandedItems: state.expandedItems.filter(path => nodes.has(path)),
      }
    }))
    tree.rebuildTree()
  }, [nodes, tree])

  const activeDropTarget = !busy && nodes.has(`/${dropTarget}`) ? dropTarget : null

  // 閉じたフォルダにも、少し待てば配下を確認しながらドロップできる。
  useEffect(() => {
    if (!activeDropTarget) return
    const timeout = window.setTimeout(() => {
      const folder = tree.getItemInstance(`/${activeDropTarget}`)
      if (!folder.isExpanded()) folder.expand()
    }, 600)
    return () => window.clearTimeout(timeout)
  }, [activeDropTarget, tree])

  const canDrop = (data: DataTransfer, directory: string) => {
    if (busy) return false
    const source = draggedPath.current
    if (source !== null) { // When we're moving items inside of tree
      return nodes.has(`/${source}`) // Dragged exists in the current file tree
        && directory !== source  // destination is not source
        && !directory.startsWith(`${source}/`) // not moving to its child
    }
    // When we're dropping items outside of tree
    return Array.from(data.types).includes('Files')
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const directory = dropDirectory(event)
    const allowed = canDrop(event.dataTransfer, directory)
    event.dataTransfer.dropEffect = allowed ? (
      draggedPath.current === null ? 'copy' // When dropping files outside of tree
        : 'move' // When moving items inside of tree
    )
      : 'none'
    setDropTarget(allowed ? directory : null)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const directory = dropDirectory(event)
    const allowed = canDrop(event.dataTransfer, directory)
    const source = draggedPath.current
    draggedPath.current = null
    setDropTarget(null)
    if (!allowed) return
    if (source !== null) onMove(source, directory)
    else onAdd(() => droppedFiles(event.dataTransfer), directory)
  }

  const remove = (path: string) => {
    onRemove(path)
  }

  const handleSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = selectedFiles(event.target.files ?? [])
    // 同じファイルを削除後に選び直せるよう、入力値をリセットする。
    event.target.value = ''
    if (!busy && selected.length) onAdd(async () => selected, '')
  }
  const handleItemKeyDown = (event: KeyboardEvent<HTMLDivElement>, item: ItemInstance<FileNode>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (item.isFolder() && item.isExpanded()) item.collapse()
      else if (item.isFolder()) item.expand()
    }
    if (event.key === 'Delete' && !busy) {
      event.preventDefault()
      remove(submissionPath(item))
    }
  }

  return <div>
    <input ref={input} type="file" multiple className="sr-only" tabIndex={-1} aria-label="提出ファイル" disabled={busy}
      onChange={handleSelect} />
    <div aria-busy={busy} className="rounded-md border"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={event => {
        if (!(event.relatedTarget instanceof Node) // When destination is not DOM node.
          || !event.currentTarget.contains(event.relatedTarget) // When destination is outside of file tree.
        ) {
          setDropTarget(null)
        }
      }}
      onDragEnd={() => {
        draggedPath.current = null
        setDropTarget(null)
      }}>
      <div {...tree.getContainerProps('選択したファイル')}>
        {tree.getItems().filter(item => nodes.has(item.getId())).map(item => {
          const path = submissionPath(item)
          const node = nodes.get(item.getId())!
          const folder = node.size === undefined
          const Icon = fileIcon(node, item.isExpanded())
          const directory = folder ? path : submissionPath(item.getParent()!)
          return <div {...item.getProps()}
            key={path}
            draggable={!busy}
            aria-label={node.name}
            data-drop-folder={directory}
            onDragStart={event => {
              if (busy) { event.preventDefault(); return }
              draggedPath.current = path
              event.dataTransfer.effectAllowed = 'move'
            }}
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-sm pr-1 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
              folder && activeDropTarget === path && 'bg-accent ring-2 ring-inset ring-ring'
            )}
            style={{ paddingLeft: item.getItemMeta().level * 16 + 4 }}
            onKeyDown={event => handleItemKeyDown(event, item)}>
            <ChevronRight aria-hidden="true" className={cn('size-3.5 shrink-0 text-muted-foreground', !folder && 'invisible', item.isExpanded() && 'rotate-90')} />
            <Icon aria-hidden="true" className={cn('size-4 shrink-0', folder ? 'text-amber-500' : 'text-blue-500')} />
            <span title={path} className="min-w-0 flex-1 truncate">{node.name}</span>
            {!folder && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fileSize(node.size!)}</span>}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label={`${path} を削除`}
              className="size-9" onKeyDown={event => event.stopPropagation()}
              onClick={event => { event.stopPropagation(); remove(path) }}>
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
          </div>
        })}
      </div>
      <button
        type="button"
        data-drop-folder=""
        disabled={busy}
        aria-label="ルートに提出ファイルを追加"
        onClick={() => input.current?.click()}
        className={cn('flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-sm px-3 py-6 text-center text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50',
          activeDropTarget === '' && 'bg-accent ring-2 ring-inset ring-ring')}>
        <Upload aria-hidden="true" className="size-6 text-muted-foreground" />
        <span>{activeDropTarget === '' ? 'ルートに配置' : 'ここにドロップ or クリック'}</span>
      </button>
      <div role="status" className="text-center text-xs text-muted-foreground">
        {busy ? '読み込み・送信中…' : ''}
      </div>
    </div>
  </div>
}
