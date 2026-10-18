import { expect, test } from 'vitest'
import { Zip, ZipPassThrough, zipSync, strToU8 } from 'fflate'
import { moveFiles, prepareFiles as prepare, submissionBody, type SubmissionFile } from './validation-files'
import { selectedFiles } from './dropped-files'

const prepareFiles = (files: File[], existing: SubmissionFile[] = []) => prepare(selectedFiles(files), existing)

test('moving files and folders changes only paths and supports returning to the root', () => {
  const files = selectedFiles([new File(['code'], 'src/main.c'), new File(['header'], 'src/lib/util.h'), new File(['other'], 'src2/keep.c')])
  const moved = moveFiles(files, 'src', 'answer')
  expect(moved.map(file => file.path)).toEqual(['answer/src/main.c', 'answer/src/lib/util.h', 'src2/keep.c'])
  expect(moved[0].content).toBe(files[0].content)
  const root = moveFiles(moved, 'answer/src/main.c', '')
  expect(root.map(file => file.path)).toEqual(['main.c', 'answer/src/lib/util.h', 'src2/keep.c'])
  expect(moveFiles(root, 'main.c', '')).toEqual(root)
  expect(files[0].path).toBe('src/main.c')
})

test('moves reject collisions and moving a folder into itself without changing the files', () => {
  const files = selectedFiles([new File(['root'], 'main.c'), new File(['nested'], 'src/main.c')])
  expect(() => moveFiles(files, 'main.c', 'src')).toThrow('衝突')
  expect(() => moveFiles(files, 'src', 'src')).toThrow('自身')
  expect(() => moveFiles(files, 'src', 'src/child')).toThrow('自身')
  expect(files.map(file => file.path)).toEqual(['main.c', 'src/main.c'])
})

test('ZIP preserves parent paths and empty files, and multipart maps every path to its bytes', async () => {
  const zip = zipSync({ 'answer/': new Uint8Array(), 'answer/main.c': strToU8('int main() {}'), empty: new Uint8Array() })
  const files = await prepareFiles([new File([zip], 'answer.zip'), new File(['report'], 'report.txt')])
  expect(files.map(file => file.path)).toEqual(['answer/main.c', 'empty', 'report.txt'])
  const { form, metadata } = submissionBody(files)
  expect(JSON.parse(await (form.get('metadata') as Blob).text())).toEqual(metadata)
  expect(await (form.get('file0') as Blob).text()).toBe('int main() {}')
  expect((form.get('file1') as Blob).size).toBe(0)
})

test('paths match backend virtual-root normalization and collisions reject the whole selection', async () => {
  const files = await prepareFiles([new File([''], '/a/../answer\\main.c'), new File([''], '../../empty')])
  expect(files.map(file => file.path)).toEqual(['answer/main.c', 'empty'])
  for (const path of ['answer/./main.c', 'answer', 'answer/main.c/child']) {
    await expect(prepareFiles([new File([''], path)], files)).rejects.toThrow('衝突')
  }
  expect(files).toHaveLength(2)
  for (const path of ['C:\\main.c', '..', 'a\0b']) await expect(prepareFiles([new File([''], path)])).rejects.toThrow('無効')
})

test('limits apply to expanded files, including existing selections', async () => {
  const fifty = Array.from({ length: 50 }, (_, index) => new File([], `${index}.c`))
  const files = await prepareFiles(fifty)
  await expect(prepareFiles([new File([], 'extra')], files)).rejects.toThrow('50ファイル')
  const oversized = zipSync({ huge: new Uint8Array(20_000_001) })
  await expect(prepareFiles([new File([oversized], 'huge.zip')])).rejects.toThrow('20 MB')
  await expect(prepareFiles([new File([zipSync({})], 'empty.zip')])).rejects.toThrow('選択')
  await expect(prepareFiles([new File(['not zip'], 'broken.zip')])).rejects.toThrow()
})

test('duplicate ZIP entries are rejected before unzip can overwrite them', async () => {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  const zip = new Zip((error, chunk) => { if (error) throw error; chunks.push(new Uint8Array(chunk)) })
  for (let i = 0; i < 2; i++) {
    const file = new ZipPassThrough('same.c')
    zip.add(file); file.push(strToU8(String(i)), true)
  }
  zip.end()
  await expect(prepareFiles([new File(chunks, 'duplicates.zip')])).rejects.toThrow('衝突')
})

test('files and ZIP entries stay inside the chosen directory with their relative paths', async () => {
  const zip = new Blob([zipSync({ '../main.c': strToU8('code'), 'lib/util.h': strToU8('header') })])
  const files = await prepare([
    { path: '../report.txt', content: new Blob(['report']) },
    { path: 'answer/source.zip', content: zip },
  ], [], 'src')
  expect(files.map(file => file.path)).toEqual(['src/report.txt', 'src/answer/main.c', 'src/answer/lib/util.h'])
  const { metadata } = submissionBody(files)
  expect(metadata.files.map(file => file.path)).toEqual(files.map(file => file.path))
  await expect(prepare([{ path: 'answer/main.c', content: new Blob(['replacement']) }], files, 'src')).rejects.toThrow('衝突')
  expect(await files[1].content.text()).toBe('code')
})
