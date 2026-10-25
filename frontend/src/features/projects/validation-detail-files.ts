import { fetchClient } from "@/api/client";
import type { components } from "@/api/schema";

type FilePart = components["schemas"]["FilePart"];

export type ResultFile = FilePart & {
  content: Blob;
  text: string | null;
  workflowId?: string;
  jobId?: string;
  name?: string;
  contentType?: string;
};

export type ResultFiles = {
  submission: ResultFile[];
  presets: ResultFile[];
  artifacts: ResultFile[];
};

export function decodeText(bytes: Uint8Array): string | null {
  const hasBinaryControlCharacter = bytes.some((byte) => {
    const isTextWhitespace = byte === 9 || byte === 10 || byte === 13;
    return (byte < 32 && !isTextWhitespace) || byte === 127;
  });
  if (hasBinaryControlCharacter) return null;

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function decodeOutput(data: string): string {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return decodeText(bytes) ?? `バイナリ出力 (Base64): ${data}`;
}

export async function loadResultFiles(
  requestId: string,
  kind: "files" | "artifacts",
  signal: AbortSignal,
): Promise<ResultFiles> {
  const endpoint =
    kind === "files"
      ? "/api/requests/{request_id}/validation/files"
      : "/api/requests/{request_id}/validation/artifacts";
  const { response, error } = await fetchClient.GET(endpoint, {
    params: { path: { request_id: requestId } },
    parseAs: "stream",
    signal,
  });
  if (error || !response.ok) {
    throw new Error("ファイルを取得できませんでした。");
  }

  const form = await response.formData();
  const metadata = parseMetadata(form);
  if (kind === "files") {
    return readValidationFiles(form, metadata);
  }
  return readValidationArtifacts(form, metadata);
}

function parseMetadata(form: FormData): unknown {
  const raw = form.get("metadata");
  if (typeof raw !== "string") {
    throw new Error("ファイル情報が不正です。");
  }
  return JSON.parse(raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readResultFile(form: FormData, entry: unknown): Promise<ResultFile> {
  if (!isRecord(entry) || typeof entry.part !== "string" || typeof entry.path !== "string") {
    throw new Error("ファイル情報が不正です。");
  }
  const content = form.get(entry.part);
  if (!content || typeof content === "string") {
    throw new Error("ファイルの内容がありません。");
  }
  const bytes = new Uint8Array(await content.arrayBuffer());
  return { ...entry, part: entry.part, path: entry.path, content, text: decodeText(bytes) };
}

async function readValidationFiles(form: FormData, metadata: unknown): Promise<ResultFiles> {
  if (
    !isRecord(metadata) ||
    !Array.isArray(metadata.submission_files) ||
    !Array.isArray(metadata.presets)
  ) {
    throw new Error("ファイル情報が不正です。");
  }

  const submission = await Promise.all(
    metadata.submission_files.map((entry) => readResultFile(form, entry)),
  );
  const presets: ResultFile[] = [];
  for (const group of metadata.presets) {
    if (!isRecord(group) || typeof group.workflow_id !== "string" || !Array.isArray(group.files)) {
      throw new Error("プリセット情報が不正です。");
    }
    const workflowId = group.workflow_id;
    const presetFiles = await Promise.all(
      group.files.map(async (entry) => {
        const file = await readResultFile(form, entry);
        return { ...file, workflowId };
      }),
    );
    presets.push(...presetFiles);
  }
  return { submission, presets, artifacts: [] };
}

async function readValidationArtifacts(form: FormData, metadata: unknown): Promise<ResultFiles> {
  if (!isRecord(metadata) || !Array.isArray(metadata.files)) {
    throw new Error("Artifact情報が不正です。");
  }

  const artifacts = await Promise.all(
    metadata.files.map(async (entry) => {
      if (
        !isRecord(entry) ||
        typeof entry.workflow_id !== "string" ||
        typeof entry.job_id !== "string" ||
        typeof entry.name !== "string" ||
        typeof entry.content_type !== "string"
      ) {
        throw new Error("Artifact情報が不正です。");
      }
      const file = await readResultFile(form, entry);
      return {
        ...file,
        workflowId: entry.workflow_id,
        jobId: entry.job_id,
        name: entry.name,
        contentType: entry.content_type,
      };
    }),
  );
  return { submission: [], presets: [], artifacts };
}
