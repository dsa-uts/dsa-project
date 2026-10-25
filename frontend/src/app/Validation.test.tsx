import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { ValidationSubmitPanel } from "@/features/projects/ValidationSubmitPanel";
import { ValidationResultsPage } from "@/features/projects/ValidationResultsPage";
import type { components } from "@/api/schema";
import { zipSync, strToU8 } from "fflate";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const row: components["schemas"]["ValidationSummary"] = {
  id: "019a0000-0000-7000-8000-000000000001",
  project: { id: "project-1", name: "課題1" },
  subject_user: { id: "student", userid: "s001", name: "提出者" },
  version: "v1.0.0",
  state: "completed",
  status: "AC",
  content_hash: `sha256:${"a".repeat(64)}`,
  duration_ms: 1200,
  requested_at: "2026-10-04T00:00:00Z",
};
function setup(path: string, handle: (request: Request) => Promise<Response>) {
  const fetchMock = vi.fn(async (request: Request) =>
    new URL(request.url).pathname === "/api/projects"
      ? Response.json({ projects: [row.project, { id: "project-2", name: "課題2" }] })
      : handle(request),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: "/submit",
        element: (
          <ValidationSubmitPanel
            projectId="project-1"
            projectName="課題1"
            requiredFiles={["main.c"]}
          />
        ),
      },
      { path: "/results", element: <ValidationResultsPage /> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  if (path === "/submit") fireEvent.click(screen.getByRole("button", { name: "サンプル提出" }));
  return { router, fetchMock, client };
}

test("submission blocks duplicate events, retains files on 413, and refreshes cached results after success", async () => {
  let release!: (response: Response) => void;
  let calls = 0;
  const { router, client } = setup("/submit", async (request) => {
    if (request.method === "POST") {
      calls++;
      expect(request.headers.get("content-type")).toContain("multipart/form-data; boundary=");
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return Response.json({ requests: [row], next: null, prev: null });
  });
  fireEvent.change(screen.getByLabelText("提出ファイル"), {
    target: { files: [new File(["code"], "main.c")] },
  });
  await screen.findByRole("button", { name: "main.c を削除" });
  fireEvent.submit(screen.getByRole("form"));
  fireEvent.submit(screen.getByRole("form"));
  expect(calls).toBe(1);
  await act(async () => release(new Response("too large", { status: 413 })));
  expect((await screen.findByRole("alert")).textContent).toContain("大きすぎます");
  expect(screen.getByRole("button", { name: "main.c を削除" })).toBeDefined();
  client.setQueryData(["get", "/api/validation", { params: { query: {} } }], {
    requests: [],
    next: null,
    prev: null,
  });
  fireEvent.submit(screen.getByRole("form"));
  await act(async () =>
    release(Response.json({ id: row.id, state: "pending", status: null }, { status: 201 })),
  );
  await screen.findByRole("table", { name: "バリデーション結果" });
  expect(router.state.location.pathname).toBe("/results");
  expect(calls).toBe(2);
});

test("network failure keeps the files and does not automatically repeat a POST", async () => {
  const { fetchMock } = setup("/submit", async () => {
    throw new TypeError("Network error");
  });
  fireEvent.drop(screen.getByRole("button", { name: "ルートに提出ファイルを追加" }), {
    dataTransfer: { types: ["Files"], files: [new File(["code"], "main.c")] },
  });
  await screen.findByRole("button", { name: "main.c を削除" });
  fireEvent.submit(screen.getByRole("form"));
  expect((await screen.findByRole("alert")).textContent).toContain("Resultsで履歴を確認");
  expect(screen.getByRole("button", { name: "main.c を削除" })).toBeDefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("submission tree shows sizes, adds to folder and file parents, and deletes only the chosen subtree", async () => {
  setup("/submit", async () => Response.json({ requests: [] }));
  const picker = screen.getByLabelText("提出ファイル");
  const root = screen.getByRole("button", { name: "ルートに提出ファイルを追加" });
  expect(screen.queryByRole("treeitem", { name: "./" })).toBeNull();
  fireEvent.keyDown(root, { key: "Delete" });
  expect(screen.getByRole("button", { name: "ルートに提出ファイルを追加" })).toBe(root);
  const click = vi.spyOn(picker, "click");
  fireEvent.click(screen.getByRole("button", { name: "ルートに提出ファイルを追加" }));
  expect(click).toHaveBeenCalledOnce();
  const zip = zipSync({ "src/main.c": strToU8("a".repeat(2400)), "src2/keep.c": strToU8("keep") });
  fireEvent.change(picker, { target: { files: [new File([zip], "source.zip")] } });
  const tree = await screen.findByRole("tree", { name: "選択したファイル" });
  const folder = await within(tree).findByRole("treeitem", { name: "src" });
  fireEvent.click(folder);
  fireEvent.click(within(tree).getByRole("treeitem", { name: "src2" }));
  const main = await within(tree).findByRole("treeitem", { name: "main.c" });
  expect(main.textContent).toContain("2.4 KB");
  fireEvent.dragOver(main, { dataTransfer: { types: ["Files"] } });
  expect(folder.classList.contains("bg-accent")).toBe(true);
  fireEvent.dragLeave(main, { relatedTarget: document.body });
  expect(screen.getByRole("status").textContent).toBe("");
  fireEvent.drop(main, {
    dataTransfer: { types: ["Files"], files: [new File(["header"], "util.h")] },
  });
  await screen.findByRole("button", { name: "src/util.h を削除" });
  fireEvent.click(folder);
  expect(folder.getAttribute("aria-expanded")).toBe("false");
  fireEvent.dragOver(folder, { dataTransfer: { types: ["Files"] } });
  await waitFor(() => expect(folder.getAttribute("aria-expanded")).toBe("true"));
  fireEvent.drop(folder, {
    dataTransfer: { types: ["Files"], files: [new File(["extra"], "extra.c")] },
  });
  await screen.findByRole("button", { name: "src/extra.c を削除" });
  expect(folder.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "src を削除" }));
  expect(screen.queryByRole("treeitem", { name: "src" })).toBeNull();
  expect(screen.getByRole("button", { name: "src2/keep.c を削除" })).toBeDefined();
  expect(click).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "src2/keep.c を削除" }));
  expect(within(tree).queryAllByRole("treeitem")).toEqual([]);
  expect(screen.getByRole("button", { name: "提出する" })).toHaveProperty("disabled", true);
});

test("tree keyboard operations and special filenames retain the final multipart paths", async () => {
  let uploaded: string[] = [];
  setup("/submit", async (request) => {
    if (request.method === "POST") {
      const body = await request.formData();
      const metadata = JSON.parse(await (body.get("metadata") as Blob).text());
      uploaded = metadata.files.map((file: { path: string }) => file.path);
      return Response.json({ message: "test" }, { status: 422 });
    }
    return Response.json({ requests: [] });
  });
  const zip = zipSync({ "src/main.c": strToU8("code"), constructor: strToU8("special") });
  fireEvent.change(screen.getByLabelText("提出ファイル"), {
    target: { files: [new File([zip], "source.zip")] },
  });
  const folder = await screen.findByRole("treeitem", { name: "src" });
  fireEvent.click(folder);
  fireEvent.keyDown(folder, { key: "Enter" });
  expect(folder.getAttribute("aria-expanded")).toBe("false");
  fireEvent.keyDown(folder, { key: "Enter" });
  expect(folder.getAttribute("aria-expanded")).toBe("true");
  fireEvent.drop(screen.getByRole("treeitem", { name: "main.c" }), {
    dataTransfer: { types: ["Files"], files: [new File(["header"], "util.h")] },
  });
  await screen.findByRole("button", { name: "src/util.h を削除" });
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(uploaded).toEqual(["src/main.c", "constructor", "src/util.h"]));
});

test("filters and bidirectional cursors live in the URL, including browser Back", async () => {
  const queries: URLSearchParams[] = [];
  const { router } = setup("/results?project_id=project-1&status=AC", async (request) => {
    const query = new URL(request.url).searchParams;
    queries.push(query);
    return Response.json({
      requests: [row],
      next: row.id,
      prev: query.has("next") ? row.id : null,
    });
  });
  await screen.findByRole("table");
  expect(screen.getByRole("button", { name: "Prev" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Prev" })).toHaveProperty("disabled", false),
  );
  expect(queries.at(-1)?.get("status")).toBe("AC");
  expect(queries.at(-1)?.get("next")).toBe(row.id);
  fireEvent.click(screen.getByRole("button", { name: "Prev" }));
  await waitFor(() => expect(queries.at(-1)?.get("prev")).toBe(row.id));
  expect(queries.at(-1)?.has("next")).toBe(false);
  fireEvent.keyDown(screen.getByLabelText("全体結果"), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "未完了" }));
  await waitFor(() => expect(queries.at(-1)?.get("state")).toBe("incomplete"));
  expect(router.state.location.search).toBe("?project_id=project-1&state=incomplete");
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "結果の課題絞り込み" })).getByRole("link", {
      name: "課題2",
    }),
  );
  await waitFor(() => expect(queries.at(-1)?.get("project_id")).toBe("project-2"));
  await act(async () => router.navigate(-1));
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("課題1");
  expect(screen.getByLabelText("全体結果")).toHaveProperty("textContent", "未完了");
  fireEvent.keyDown(screen.getByLabelText("全体結果"), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "すべて" }));
  await waitFor(() => expect(router.state.location.search).toBe("?project_id=project-1"));
});

test("empty cursor pages return to the first page with the same filter", async () => {
  const { router } = setup(`/results?status=AC&next=${row.id}`, async (request) =>
    Response.json({
      requests: new URL(request.url).searchParams.has("next") ? [] : [row],
      next: null,
      prev: null,
    }),
  );
  await screen.findByRole("table");
  expect(router.state.location.search).toBe("?status=AC");
});

test("polling stops on completion; refetch errors retain rows and allow manual recovery", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let completed = false;
  let failed = false;
  const { fetchMock, client } = setup("/results", async () =>
    failed
      ? Response.json({ code: 500, message: "failed" }, { status: 500 })
      : Response.json({
          requests: [
            {
              ...row,
              state: completed ? "completed" : "retrying",
              status: completed ? "AC" : null,
              duration_ms: completed ? 1200 : null,
            },
          ],
          next: null,
          prev: null,
        }),
  );
  await screen.findByText("再試行中");
  completed = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  await waitFor(() => expect(screen.getByRole("cell", { name: "AC" })).toBeDefined());
  const count = fetchMock.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(count);
  vi.useRealTimers();
  failed = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["get", "/api/validation"] });
  });
  await screen.findByRole("alert");
  expect(screen.getByRole("table")).toBeDefined();
  failed = false;
  fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
