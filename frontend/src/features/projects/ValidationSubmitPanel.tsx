import { useRef, useState, type SubmitEventHandler } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { fetchClient } from "@/api/client";
import { Button } from "@/components/ui/button";
import { moveFiles, prepareFiles, submissionBody, type SubmissionFile } from "./validation-files";
import { SubmissionFileTree } from "./SubmissionFileTree";

export function ValidationSubmitPanel({
  projectId,
  projectName,
  requiredFiles,
}: {
  projectId: string;
  projectName: string;
  requiredFiles: string[];
}) {
  const [open, setOpen] = useState(false);
  // 再描画前の連続操作も防ぐため、表示用の busy とは別に ref で排他する。
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<SubmissionFile[]>([]);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const select = async (read: () => Promise<SubmissionFile[]>, directory: string) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const selected = await read();
      setFiles(await prepareFiles(selected, files, directory));
    } catch (error) {
      setError(error instanceof Error ? error.message : "ファイルを読み込めませんでした。");
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const submit: SubmitEventHandler = async (event) => {
    event.preventDefault();
    if (working.current || !files.length) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const { metadata, form } = submissionBody(files);
      const result = await fetchClient.POST("/api/projects/{project_id}/validation", {
        params: { path: { project_id: projectId } },
        body: { metadata },
        bodySerializer: () => form,
      });
      if (!result.response.ok) {
        if (result.response.status === 413) {
          setError("提出データが大きすぎます。ファイルの容量を減らしてください。");
        } else if (typeof result.error === "object" && result.error) {
          setError(result.error.message);
        } else {
          setError("提出できませんでした。もう一度お試しください。");
        }
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["get", "/api/validation"] });
      navigate("/results");
    } catch {
      setError("提出の受付を確認できませんでした。Resultsで履歴を確認してから再提出してください。");
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const handleMove = (path: string, directory: string) => {
    if (working.current) return;
    try {
      setFiles(moveFiles(files, path, directory));
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "ファイルを移動できませんでした。");
    }
  };
  const handleRemove = (path: string) => {
    if (working.current) return;
    setFiles(files.filter((file) => file.path !== path && !file.path.startsWith(`${path}/`)));
    setError("");
  };

  return (
    <Dialog.Root modal={false} open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button className="fixed right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 h-12 bg-top-bar px-5 text-top-bar-foreground shadow-lg hover:bg-top-bar-hover sm:right-8">
          <Upload aria-hidden="true" />
          サンプル提出
        </Button>
      </Dialog.Trigger>
      <Dialog.Content
        aria-describedby={undefined}
        onInteractOutside={(event) => event.preventDefault()}
        className="absolute inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-card text-foreground shadow-xl sm:max-w-[25rem] motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:slide-in-from-right motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:slide-out-to-right"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b p-5">
          <Dialog.Title className="min-w-0 text-xl font-bold break-words">
            {projectName}を提出（サンプル）
          </Dialog.Title>
          <Dialog.Close asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="提出パネルを閉じる">
              <X aria-hidden="true" />
            </Button>
          </Dialog.Close>
        </div>
        <form onSubmit={submit} aria-label="課題を提出" className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            {requiredFiles.length > 0 && (
              <ul
                aria-label="提出が求められているファイル"
                className="rounded-md bg-muted p-3 font-mono text-sm"
              >
                {requiredFiles.map((file, index) => (
                  <li key={index} className="break-words whitespace-pre-wrap">
                    {file}
                  </li>
                ))}
              </ul>
            )}
            <SubmissionFileTree
              files={files}
              busy={busy}
              onAdd={select}
              onMove={handleMove}
              onRemove={handleRemove}
            />
            {error && (
              <p role="alert" className="break-words text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="shrink-0 border-t p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <Button
              type="submit"
              className="h-11 w-full bg-top-bar text-top-bar-foreground hover:bg-top-bar-hover"
              disabled={busy || !files.length}
            >
              {busy ? "処理中…" : "提出する"}
            </Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
