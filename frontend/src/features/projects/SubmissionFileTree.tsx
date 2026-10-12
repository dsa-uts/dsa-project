import { useEffect, useMemo, useRef, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react'
import { dragAndDropFeature, hotkeysCoreFeature, syncDataLoaderFeature, type DndDataRef, type ItemInstance } from '@headless-tree/core'
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

function destinationDirectory(item: ItemInstance<FileNode>) {
  // ファイル行へのドロップは、そのファイルの親フォルダへの追加として扱う。
  return submissionPath(item.isFolder() ? item : item.getParent()!)
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
  const addButton = useRef<HTMLButtonElement>(null)
  const nodes = useMemo(() => buildFileTree(files), [files])
  const acceptsFiles = (data: DataTransfer) => !busy && Array.from(data.types).includes('Files')
  const tree = useTree<FileNode>({
    rootItemId: '/',
    getItemName: item => item.getItemData().name,
    isItemFolder: item => item.getItemData().size === undefined,
    dataLoader: {
      getItem: path => nodes.get(path)!,
      getChildren: path => nodes.get(path)?.children ?? [],
    },
    // 行間ドロップで親フォルダを選ぶ。表示順は buildFileTree の名前順を維持する。
    canReorder: true,
    indent: 16,
    canDrag: () => !busy,
    canDrop: (_, target) => !busy && target.item.isFolder(),
    onDrop: (items, target) => onMove(submissionPath(items[0]), destinationDirectory(target.item)),
    canDragForeignDragObjectOver: acceptsFiles,
    canDropForeignDragObject: acceptsFiles,
    onDropForeignDragObject: (data, target) => onAdd(
      () => droppedFiles(data),
      destinationDirectory(target.item)
    ),
    features: [
      syncDataLoaderFeature,
      hotkeysCoreFeature,
      dragAndDropFeature,
    ],
  })

  // ファイル更新後の構造をキャッシュへ反映し、削除済みの行へのフォーカスを解除する。
  useEffect(() => {
    const state = tree.getState()
    tree.setConfig(config => ({
      ...config, state: {
        ...state,
        focusedItem: state.focusedItem && nodes.has(state.focusedItem) ? state.focusedItem : null,
      }
    }))
    tree.rebuildTree()
  }, [nodes, tree])

  const target = tree.getDragTarget()
  const dragged = tree.getState().dnd?.draggedItems?.[0]
  const dropDirectory = !busy && target ? destinationDirectory(target.item) : null
  const clearTreeDrag = () => {
    // 余白から同じ行へ戻ったときも移動先を再計算できるよう、直前のドラッグ判定を消す。
    tree.getDataRef<DndDataRef>().current.lastDragCode = undefined
    tree.applySubStateUpdate('dnd', state => ({
      ...state,
      dragTarget: undefined,
      draggingOverItem: undefined
    }))
  }
  const remove = (path: string) => {
    onRemove(path)
    addButton.current?.focus()
  }

  const handleSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = selectedFiles(event.target.files ?? [])
    // 同じファイルを削除後に選び直せるよう、入力値をリセットする。
    event.target.value = ''
    if (selected.length) onAdd(async () => selected, '')
  }
  const handleDragOverCapture = (event: DragEvent<HTMLDivElement>) => {
    if (!busy && dragged) event.dataTransfer.dropEffect = 'move'
    else if (acceptsFiles(event.dataTransfer)) event.dataTransfer.dropEffect = 'copy'
    else event.dataTransfer.dropEffect = 'none'
  }
  const handleRootDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    clearTreeDrag()
  }
  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const staysInside = event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
    if (staysInside) return
    clearTreeDrag()
  }
  const handleRootDrop = (event: DragEvent<HTMLDivElement>) => {
    // 行側で処理済みのドロップをルートでも処理しない。
    if (event.defaultPrevented) return
    event.preventDefault()
    clearTreeDrag()
    if (!busy && dragged) onMove(submissionPath(dragged), '')
    else if (acceptsFiles(event.dataTransfer)) onAdd(() => droppedFiles(event.dataTransfer), '')
    tree.applySubStateUpdate('dnd', null)
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
    <div aria-busy={busy} className='relative min-h-56 rounded-md border-2 border-dashed p-2 hover:border-primary'
      onDragOverCapture={handleDragOverCapture}
      onDragOver={handleRootDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleRootDrop}>
      <button ref={addButton} type="button" aria-label="提出ファイルを追加" disabled={busy}
        onClick={() => input.current?.click()}
        className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait">
        {!files.length && <>
          <Upload className="size-8" aria-hidden="true" />
          <span className="text-sm">クリック、またはファイル・フォルダ・ZIPをドロップ</span>
        </>}
      </button>
      {files.length > 0 && <div {...tree.getContainerProps('選択したファイル')} className="relative mb-10"
        onClick={event => { if (event.target === event.currentTarget && !busy) input.current?.click() }}>
        {tree.getItems().filter(item => nodes.has(item.getId())).map(item => {
          const path = submissionPath(item)
          const node = nodes.get(item.getId())!
          const folder = node.size === undefined
          const directory = destinationDirectory(item)
          const Icon = fileIcon(node, item.isExpanded())
          return <div {...item.getProps()} key={path} draggable={!busy} aria-label={node.name}
            className={cn('flex min-h-11 items-center gap-2 rounded-sm pr-1 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring', dropDirectory === directory && 'bg-accent')}
            style={{ paddingLeft: item.getItemMeta().level * 16 + 4 }}
            onKeyDown={event => handleItemKeyDown(event, item)}>
            <ChevronRight aria-hidden="true" className={cn('size-3.5 shrink-0 text-muted-foreground', !folder && 'invisible', item.isExpanded() && 'rotate-90')} />
            <Icon aria-hidden="true" className={cn('size-4 shrink-0', folder ? 'text-amber-500' : 'text-blue-500')} />
            <span title={path} className="min-w-0 flex-1 truncate">{node.name}</span>
            {!folder && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fileSize(node.size!)}</span>}
            <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`${path} を削除`}
              className="size-9" onKeyDown={event => event.stopPropagation()}
              onClick={event => { event.stopPropagation(); remove(path) }}>
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
          </div>
        })}
        {!busy && <div aria-hidden="true" data-testid="submission-drop-line"
          style={tree.getDragLineStyle(-1, 4)} className="h-0.5 bg-primary" />}
      </div>}
      <div role="status" className="pointer-events-none absolute inset-x-2 bottom-2 truncate text-center text-xs text-muted-foreground">
        {busy ? '読み込み・送信中…' : ''}
      </div>
    </div>
  </div>
}
