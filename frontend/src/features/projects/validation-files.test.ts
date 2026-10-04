import { expect, test } from 'vitest'
import { Zip, ZipPassThrough, zipSync, strToU8 } from 'fflate'
import { prepareFiles, submissionBody } from './validation-files'

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
