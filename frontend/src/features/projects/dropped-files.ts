import type { SubmissionFile } from "./validation-files";

export function selectedFiles(files: FileList | File[]): SubmissionFile[] {
  return Array.from(files, (file) => ({
    path: file.webkitRelativePath || file.name,
    content: file,
  }));
}

/**
 * ドロップされたファイル・フォルダを、パス付きのファイル一覧に変換する
 *
 * 入力:
 * submission/
 * ├── main.c
 * └── include/
 *     └── util.h
 * README.md
 *
 * 出力:
 * [
 *   SubmissionFile(path: "README.md", content: File("README.md")),
 *   SubmissionFile(path: "submission/main.c", content: File("submission/main.c")),
 *   SubmissionFile(path: "submission/include/util.h", content: File("submission/include/util.h"))
 * ]
 **/
export async function droppedFiles(data: DataTransfer): Promise<SubmissionFile[]> {
  // items := [
  //   DataTransferItem("submission"), -- kind is 'file' even if it's folder.
  //   DataTransferItem("README.md")
  // ]
  const items = Array.from(data.items ?? []).filter((item) => item.kind === "file");

  // If items is empty, extract data.files.
  // Outputs:
  // [
  //   SubmissionFile("README.md")
  // ]
  if (!items.length) return selectedFiles(data.files);

  // drop イベントの同期処理中に、全項目の参照を確保する
  // await 後では dataTransfer から取得できないため、探索を始める前にまとめて取得する。
  //
  // Outputs:
  // [
  //   { entry: DirectoryEntry("submission"), file: null },
  //   { entry: FileEntry("README.md"), file: File("README.md") }
  // ]
  const entries = items.map((item) => ({
    entry: item.webkitGetAsEntry?.(),
    file: item.getAsFile(),
  }));

  const files: SubmissionFile[] = [];

  const visit = async (entry: FileSystemEntry, parent: string): Promise<void> => {
    // Example:
    //   parent = "submission/include/"
    //   entry.name = "util.h"
    //   -> path = "submission/include/util.h"
    const path = parent + entry.name;
    if (entry.isFile) {
      // When entry is FileSystemFileEntry
      const content = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      files.push({ path, content });
      if (files.length > 50) throw new Error("提出できるのは50ファイル、合計20 MBまでです。");
      return;
    }

    // When entry is FileSystemDirectoryEntry
    const reader = (entry as FileSystemDirectoryEntry).createReader();

    // To read all files in a directory, readEntries needs to be called repeatedly until it returns an empty array.
    // ref: https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry#javascript
    while (true) {
      const children = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (!children.length) break;

      // Example:
      //   visit(FileEntry("main.c"), "submission/")
      //   visit(DirectoryEntry("include"), "submission/")
      for (const child of children) {
        await visit(child, `${path}/`);
      }
    }
  };

  for (const { entry, file } of entries) {
    if (entry) {
      await visit(entry, "");
    } else if (file) {
      files.push({ path: file.name, content: file });
    } else {
      throw new Error("読み込めない項目があります。フォルダはZIPにまとめて追加してください。");
    }
  }
  return files;
}
