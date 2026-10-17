import { expect, test } from 'vitest'
import { buildFileTree } from './submission-file-tree'

test('builds parent folders once and orders folders before files with numeric names', () => {
  const nodes = buildFileTree([
    { path: 'README.md', content: new Blob(['abc']) },
    { path: 'src/file10.c', content: new Blob(['code']) },
    { path: 'src/file2.c', content: new Blob([]) },
    { path: 'src/lib/util.h', content: new Blob(['header']) },
  ])

  expect(nodes.size).toBe(8)
  expect(nodes.get('/')).toEqual({ name: './', children: ['/src', '/README.md'] })
  expect(nodes.get('/src')).toEqual({
    name: 'src', children: ['/src/lib', '/src/file2.c', '/src/file10.c'],
  })
  expect(nodes.get('/src/lib')).toEqual({ name: 'lib', children: ['/src/lib/util.h'] })
  expect(nodes.get('/README.md')).toEqual({ name: 'README.md', children: [], size: 3 })
  expect(nodes.get('/src/file2.c')).toEqual({ name: 'file2.c', children: [], size: 0 })
})

test('keeps only the root when no files are selected', () => {
  expect([...buildFileTree([])]).toEqual([
    ['root', { name: '', children: ['/'] }],
    ['/', { name: './', children: [] }],
  ])
})
