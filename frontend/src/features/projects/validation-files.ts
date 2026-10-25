import { unzipSync } from "fflate";

export type SubmissionFile = { path: string; content: Blob };
const maxBytes = 20_000_000;

function checkPath(path: string, paths: string[]) {
  const conflict = paths.find(
    (other) => other === path || other.startsWith(`${path}/`) || path.startsWith(`${other}/`),
  );
  if (conflict) throw new Error(`パスが重複または衝突しています: ${path} / ${conflict}`);
}

export function moveFiles(files: SubmissionFile[], source: string, directory: string) {
  if (directory === source || directory.startsWith(`${source}/`))
    throw new Error("フォルダを自身の配下には移動できません。");
  const name = source.slice(source.lastIndexOf("/") + 1);
  const destination = directory ? `${directory}/${name}` : name;
  const paths: string[] = [];
  return files.map((file) => {
    const path =
      file.path === source || file.path.startsWith(`${source}/`)
        ? destination + file.path.slice(source.length)
        : file.path;
    checkPath(path, paths);
    paths.push(path);
    return { path, content: file.content };
  });
}

function normalizePath(name: string) {
  const slashed = name.replaceAll("\\", "/");
  if (slashed.includes("\0") || slashed[1] === ":") throw new Error(`無効なパスです: ${name}`);
  const parts: string[] = [];
  for (const part of slashed.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  if (!parts.length) throw new Error(`無効なパスです: ${name}`);
  return parts.join("/");
}

export async function prepareFiles(
  selected: SubmissionFile[],
  existing: SubmissionFile[] = [],
  directory = "",
): Promise<SubmissionFile[]> {
  const files = [...existing];
  const paths = existing.map((file) => file.path);
  let bytes = existing.reduce((sum, file) => sum + file.content.size, 0);
  const reserve = (name: string, size: number) => {
    const path = normalizePath(name);
    checkPath(path, paths);
    paths.push(path);
    bytes += size;
    if (paths.length > 50 || bytes > maxBytes)
      throw new Error("提出できるのは50ファイル、合計20 MBまでです。");
    return path;
  };
  for (const file of selected) {
    const relativePath = normalizePath(file.path);
    const path = directory ? `${directory}/${relativePath}` : relativePath;
    if (!/\.zip$/i.test(path)) {
      files.push({ path: reserve(path, file.content.size), content: file.content });
      continue;
    }
    const parent = path.slice(0, path.lastIndexOf("/") + 1);
    const entryPath = (name: string) => parent + normalizePath(name);
    const entries = unzipSync(new Uint8Array(await file.content.arrayBuffer()), {
      filter(entry) {
        if (entry.name.replaceAll("\\", "/").endsWith("/")) return false;
        // 同名エントリーが展開結果で上書きされる前に、重複を検出する。
        reserve(entryPath(entry.name), entry.originalSize);
        return true;
      },
    });
    for (const [name, content] of Object.entries(entries)) {
      files.push({ path: entryPath(name), content: new Blob([new Uint8Array(content)]) });
    }
  }
  if (!files.length) throw new Error("提出するファイルを選択してください。");
  if (files.reduce((sum, file) => sum + file.content.size, 0) > maxBytes)
    throw new Error("提出できるのは50ファイル、合計20 MBまでです。");
  return files;
}

export function submissionBody(files: SubmissionFile[]) {
  const metadata = {
    files: files.map((file, index) => ({ part: `file${index}`, path: file.path })),
  };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  files.forEach((file, index) => form.append(`file${index}`, file.content, "file"));
  return { metadata, form };
}
