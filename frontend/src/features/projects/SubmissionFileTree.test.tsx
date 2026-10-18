import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { SubmissionFileTree } from './SubmissionFileTree'

afterEach(cleanup)

function setup() {
  const props = {
    files: ['src/main.c', 'src/lib/util.h', 'root.txt'].map(path => ({ path, content: new Blob(['code']) })),
    busy: false,
    onAdd: vi.fn(),
    onMove: vi.fn(),
    onRemove: vi.fn(),
  }
  const view = render(<SubmissionFileTree {...props} />)
  const folder = screen.getByRole('treeitem', { name: 'src' })
  fireEvent.click(folder)
  const file = screen.getByRole('treeitem', { name: 'main.c' })
  const root = screen.getByRole('button', { name: 'ルートに提出ファイルを追加' })
  return { ...view, props, folder, file, root }
}

function dragData() {
  return { types: ['text/plain'], setData: vi.fn(), effectAllowed: 'none', dropEffect: 'none' }
}

function dragOver(target: Element, dataTransfer: object) {
  const event = createEvent.dragOver(target, { dataTransfer })
  fireEvent(target, event)
  return (event as DragEvent).dataTransfer?.dropEffect
}

test('moves files and folders to the root and resolves the actual drop location again', () => {
  const { props, folder, file, root } = setup()
  const dataTransfer = dragData()
  fireEvent.dragStart(file, { dataTransfer })
  fireEvent.dragOver(folder, { dataTransfer })
  // No dragover on the root: drop must use its own event target, not the last highlight.
  fireEvent.drop(root.querySelector('svg')!, { dataTransfer })
  expect(props.onMove).toHaveBeenLastCalledWith('src/main.c', '')
  expect(props.onAdd).not.toHaveBeenCalled()
  fireEvent.dragStart(folder, { dataTransfer })
  expect(dragOver(root, dataTransfer)).toBe('move')
  expect(root.classList.contains('bg-accent')).toBe(true)
  fireEvent.drop(root, { dataTransfer })
  expect(props.onMove).toHaveBeenLastCalledWith('src', '')
  expect(root.classList.contains('bg-accent')).toBe(false)
})

test('rejects self and descendant moves and clears a cancelled drag', () => {
  const { props, folder, root } = setup()
  const dataTransfer = dragData()
  fireEvent.dragStart(folder, { dataTransfer })
  for (const target of [folder, screen.getByRole('treeitem', { name: 'lib' })]) {
    expect(dragOver(target, dataTransfer)).toBe('none')
    fireEvent.drop(target, { dataTransfer })
    expect(props.onMove).not.toHaveBeenCalled()
    fireEvent.dragStart(folder, { dataTransfer })
  }
  fireEvent.dragOver(root, { dataTransfer })
  fireEvent.dragEnd(folder, { dataTransfer })
  expect(root.classList.contains('bg-accent')).toBe(false)
  fireEvent.drop(root, { dataTransfer })
  expect(props.onMove).not.toHaveBeenCalled()
  expect(props.onAdd).not.toHaveBeenCalled()
})

test('delegates external drops from nested icons, retains highlights within the container, and uses file parents', async () => {
  const { props, folder, file, root } = setup()
  const dataTransfer = { types: ['Files'], files: [new File(['new'], 'new.c')], dropEffect: 'none' }
  expect(dragOver(file.querySelector('svg')!, dataTransfer)).toBe('copy')
  expect(folder.classList.contains('bg-accent')).toBe(true)
  const leave = createEvent.dragLeave(file)
  Object.defineProperty(leave, 'relatedTarget', { value: folder })
  fireEvent(file, leave)
  expect(folder.classList.contains('bg-accent')).toBe(true)
  fireEvent.dragLeave(folder, { relatedTarget: document.body })
  expect(folder.classList.contains('bg-accent')).toBe(false)
  fireEvent.drop(file.querySelector('svg')!, { dataTransfer })
  expect(props.onAdd).toHaveBeenLastCalledWith(expect.any(Function), 'src')
  const read = props.onAdd.mock.calls[0][0]
  expect(await read()).toEqual([{ path: 'new.c', content: dataTransfer.files[0] }])
  fireEvent.drop(root, { dataTransfer })
  expect(props.onAdd).toHaveBeenLastCalledWith(expect.any(Function), '')
})

test('blocks drops when busy, including a drag started before busy changed', () => {
  const { props, file, root, rerender } = setup()
  const dataTransfer = dragData()
  fireEvent.dragStart(file, { dataTransfer })
  rerender(<SubmissionFileTree {...props} busy />)
  expect(dragOver(root, dataTransfer)).toBe('none')
  fireEvent.drop(root, { dataTransfer })
  fireEvent.drop(root, { dataTransfer: { types: ['Files'], files: [new File(['x'], 'x.c')] } })
  expect(props.onMove).not.toHaveBeenCalled()
  expect(props.onAdd).not.toHaveBeenCalled()
  expect(root).toHaveProperty('disabled', true)
})
