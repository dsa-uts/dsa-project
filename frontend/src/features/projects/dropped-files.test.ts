import { expect, test, vi } from "vitest";
import { droppedFiles } from "./dropped-files";

function file(name: string): FileSystemEntry {
  return {
    name,
    isFile: true,
    file: (resolve: (file: File) => void) => resolve(new File(["code"], name)),
  } as FileSystemFileEntry;
}

function directory(name: string, batches: FileSystemEntry[][]): FileSystemEntry {
  let index = 0;
  return {
    name,
    isDirectory: true,
    createReader: () => ({
      readEntries: (resolve: (entries: FileSystemEntry[]) => void) =>
        resolve(batches[index++] ?? []),
    }),
  } as FileSystemDirectoryEntry;
}

function transfer(entries: FileSystemEntry[]): DataTransfer {
  return {
    items: entries.map((entry) => ({
      kind: "file",
      webkitGetAsEntry: () => entry,
      getAsFile: () => null,
    })),
  } as unknown as DataTransfer;
}

test("folder drops retain the outer folder, nested paths, and every readEntries batch", async () => {
  const data = transfer([
    directory("src", [[file("main.c")], [directory("lib", [[file("util.h")]])]]),
    file("Makefile"),
  ]);
  const files = await droppedFiles(data);
  expect(files.map((file) => file.path)).toEqual(["src/main.c", "src/lib/util.h", "Makefile"]);
  expect(await files[1].content.text()).toBe("code");
});

test("captures all drop entries before asynchronous reads, and returns no files for empty folders", async () => {
  const data = transfer([directory("empty", []), file("main.c")]);
  const capture = vi.spyOn(data.items[1], "webkitGetAsEntry");
  const reading = droppedFiles(data);
  expect(capture).toHaveBeenCalledOnce();
  expect((await reading).map((file) => file.path)).toEqual(["main.c"]);
  await expect(droppedFiles(transfer([directory("empty", [])]))).resolves.toEqual([]);
});

test("read failures reject the entire drop and excessive folder contents stop traversal", async () => {
  const broken = {
    name: "broken",
    isFile: true,
    file: (_: unknown, reject: (error: Error) => void) => reject(new Error("read failed")),
  } as unknown as FileSystemEntry;
  await expect(droppedFiles(transfer([file("ok.c"), broken]))).rejects.toThrow("read failed");
  const many = directory("src", [Array.from({ length: 51 }, (_, index) => file(`${index}.c`))]);
  await expect(droppedFiles(transfer([many]))).rejects.toThrow("50ファイル");
});
