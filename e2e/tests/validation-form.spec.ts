import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { components } from "../../frontend/src/api/schema.js";

test("drop folders into the submission tree and persist files at the pointed directory", async ({
  page,
}) => {
  const temporary = await mkdtemp(join(tmpdir(), "dsa-submission-"));
  try {
    await mkdir(join(temporary, "src", "lib"), { recursive: true });
    await writeFile(join(temporary, "src", "main.c"), "a".repeat(2400));
    await writeFile(join(temporary, "src", "lib", "util.h"), "header");
    await writeFile(join(temporary, "extra.c"), "extra");
    await page.goto("/login");
    await page.getByLabel("User ID", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("admin");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    const imported = await page.request.post("/api/admin/resource-imports", {
      data: { resource_id: "ex1", version: "v1.0.0" },
    });
    expect(imported.status(), await imported.text()).toBe(200);
    const { project_id } = await imported.json();
    await page.goto(`/projects/${project_id}`);
    await page.getByRole("button", { name: "サンプル提出", exact: true }).click();
    const root = page.getByRole("button", { name: "ルートに提出ファイルを追加", exact: true });
    await expect(root).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "./", exact: true })).toHaveCount(0);
    await root.focus();
    await page.keyboard.press("Delete");
    await expect(root).toBeVisible();

    const session = await page.context().newCDPSession(page);
    const drop = async (
      path: string,
      target: ReturnType<typeof page.getByRole>,
      directory = target,
    ) => {
      // パネルの表示アニメーションが終わってから CDP 用の座標を取得する。
      await target.hover();
      const bounds = await target.boundingBox();
      expect(bounds).not.toBeNull();
      const x = bounds!.x + bounds!.width / 2;
      const y = bounds!.y + bounds!.height / 2;
      const data = { items: [], files: [path], dragOperationsMask: 1 };
      await session.send("Input.dispatchDragEvent", { type: "dragEnter", x, y, data });
      await session.send("Input.dispatchDragEvent", { type: "dragOver", x, y, data });
      await expect(directory).toHaveClass(/(?:^|\s)bg-accent(?:\s|$)/);
      if ((await target.getAttribute("aria-expanded")) === "false") {
        await expect(target).toHaveAttribute("aria-expanded", "true");
      }
      const blank = await page.getByRole("button", { name: "提出パネルを閉じる" }).boundingBox();
      // CDP first enters the new element; a second event delivers dragover there.
      await session.send("Input.dispatchDragEvent", {
        type: "dragOver",
        x: blank!.x + 3,
        y: blank!.y + 3,
        data,
      });
      await session.send("Input.dispatchDragEvent", {
        type: "dragOver",
        x: blank!.x + 3,
        y: blank!.y + 3,
        data,
      });
      await expect(directory).not.toHaveClass(/(?:^|\s)bg-accent(?:\s|$)/);
      await session.send("Input.dispatchDragEvent", { type: "dragOver", x, y, data });
      await session.send("Input.dispatchDragEvent", { type: "dragOver", x, y, data });
      await expect(directory).toHaveClass(/(?:^|\s)bg-accent(?:\s|$)/);
      await session.send("Input.dispatchDragEvent", { type: "drop", x, y, data });
      await expect(page.getByRole("dialog").getByRole("status")).toBeEmpty();
    };
    await drop(join(temporary, "src"), root);
    const chooser = page.waitForEvent("filechooser");
    await root.focus();
    await page.keyboard.press("Enter");
    await (
      await chooser
    ).setFiles({ name: "root.txt", mimeType: "text/plain", buffer: Buffer.from("root") });
    await expect(page.getByRole("treeitem", { name: "root.txt", exact: true })).toBeVisible();
    await page.getByRole("treeitem", { name: "src", exact: true }).click();
    await page.getByRole("treeitem", { name: "lib", exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "main.c", exact: true })).toContainText(
      "2.4 KB",
    );
    await expect(
      page.getByRole("button", { name: "src/lib/util.h を削除", exact: true }),
    ).toBeVisible();
    const src = page.getByRole("treeitem", { name: "src", exact: true });
    await src.click();
    await page.keyboard.press("ArrowRight");
    await expect(src).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(src).toHaveAttribute("aria-expanded", "false");
    await drop(join(temporary, "extra.c"), src);
    await expect(src).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "src/extra.c を削除", exact: true }).click();
    await drop(
      join(temporary, "extra.c"),
      page.getByRole("treeitem", { name: "main.c", exact: true }),
      src,
    );
    await expect(
      page.getByRole("button", { name: "src/extra.c を削除", exact: true }),
    ).toBeVisible();
    const drag = async (
      source: ReturnType<typeof page.getByRole>,
      target: ReturnType<typeof page.getByRole>,
    ) => {
      await source.hover();
      const bounds = await source.boundingBox();
      await page.mouse.down();
      // ドロップ先へのスクロール前に、元の行でドラッグを開始する。
      await page.mouse.move(bounds!.x + bounds!.width / 2 + 10, bounds!.y + bounds!.height / 2, {
        steps: 5,
      });
      await target.hover();
      // dragenter に続けて dragover を発生させ、ドロップを許可する。
      await target.hover();
      await page.mouse.up();
    };
    const move = async (
      name: string,
      target: ReturnType<typeof page.getByRole>,
      directory: string,
    ) => {
      await drag(page.getByRole("treeitem", { name, exact: true }), target);
      const path = directory ? `${directory}/${name}` : name;
      await expect(page.getByRole("button", { name: `${path} を削除`, exact: true })).toBeVisible();
      await expect(page.getByRole("dialog").getByRole("status")).toBeEmpty();
    };
    await move("extra.c", root, "");
    await move("extra.c", page.getByRole("treeitem", { name: "main.c", exact: true }), "src");
    await drag(
      page.getByRole("treeitem", { name: "main.c", exact: true }),
      page.getByRole("treeitem", { name: "lib", exact: true }),
    );
    await expect(
      page.getByRole("button", { name: "src/lib/main.c を削除", exact: true }),
    ).toBeVisible();
    await move("main.c", src, "src");
    await drag(page.getByRole("treeitem", { name: "root.txt", exact: true }), src);
    await expect(
      page.getByRole("button", { name: "src/root.txt を削除", exact: true }),
    ).toBeVisible();
    await drag(page.getByRole("treeitem", { name: "lib", exact: true }), root);
    await page.getByRole("treeitem", { name: "lib", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "lib/util.h を削除", exact: true }),
    ).toBeVisible();
    await drop(join(temporary, "src", "lib"), src);
    await page
      .getByRole("treeitem", { name: "lib", exact: true })
      .filter({ has: page.getByRole("button", { name: "src/lib を削除", exact: true }) })
      .click();
    await expect(
      page.getByRole("button", { name: "src/lib/util.h を削除", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "src/lib を削除", exact: true }).click();
    await drag(page.getByRole("treeitem", { name: "extra.c", exact: true }), root);
    await expect(page.getByRole("button", { name: "extra.c を削除", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "lib を削除", exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "lib", exact: true })).toHaveCount(0);
    await page.screenshot({ path: "test-results/submission-tree-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: "test-results/submission-tree-mobile.png", fullPage: true });
    const creation = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/projects/${project_id}/validation`),
    );
    await page.getByRole("button", { name: "提出する", exact: true }).click();
    const response = await creation;
    expect(response.status(), await response.text()).toBe(201);
    const created: components["schemas"]["CreatedRequest"] = await response.json();
    const files = await page.request.get(`/api/requests/${created.id}/validation/files`);
    expect(files.status()).toBe(200);
    const form = await new Response(new Uint8Array(await files.body()), {
      headers: { "Content-Type": files.headers()["content-type"] },
    }).formData();
    const metadata: components["schemas"]["ValidationFilesMetadata"] = JSON.parse(
      String(form.get("metadata")),
    );
    expect(metadata.submission_files.map((file) => file.path).sort()).toEqual([
      "extra.c",
      "src/main.c",
      "src/root.txt",
    ]);
    const extra = metadata.submission_files.find((file) => file.path === "extra.c")!;
    expect(await (form.get(extra.part) as Blob).text()).toBe("extra");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("submit files through the form, navigate to Results, and filter persisted Requests", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByLabel("User ID", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("admin");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  const imported = await page.request.post("/api/admin/resource-imports", {
    data: { resource_id: "ex1", version: "v1.0.0" },
  });
  expect(imported.status(), await imported.text()).toBe(200);
  const { project_id } = await imported.json();
  await page.goto(`/projects/${project_id}`);
  await page.getByRole("button", { name: "サンプル提出", exact: true }).click();
  const source = `// ${randomUUID()}\nint main(void) { return 0; }\n`;
  await page.getByLabel("提出ファイル", { exact: true }).setInputFiles([
    { name: "main.c", mimeType: "text/plain", buffer: Buffer.from(source) },
    { name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) },
  ]);
  await expect(page.getByRole("tree", { name: "選択したファイル" })).toContainText("empty.txt");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "サンプル提出", exact: true }).click();
  await expect(page.getByRole("tree", { name: "選択したファイル" })).toContainText("empty.txt");
  const creation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/projects/${project_id}/validation`),
  );
  await page.getByRole("button", { name: "提出する", exact: true }).click();
  const response = await creation;
  expect(response.status(), await response.text()).toBe(201);
  const created: components["schemas"]["CreatedRequest"] = await response.json();
  await expect(page).toHaveURL(/\/results$/);
  await expect(page.getByRole("heading", { level: 1, name: "All", exact: true })).toBeVisible();
  const row = page.getByRole("row").filter({ has: page.locator(`[title="${created.id}"]`) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("v1.0.0");

  // Inspect through the public API to ensure the browser's multipart kept the bytes and paths.
  const files = await page.request.get(`/api/requests/${created.id}/validation/files`);
  expect(files.status()).toBe(200);
  const form = await new Response(new Uint8Array(await files.body()), {
    headers: { "Content-Type": files.headers()["content-type"] },
  }).formData();
  const metadata: components["schemas"]["ValidationFilesMetadata"] = JSON.parse(
    String(form.get("metadata")),
  );
  expect(metadata.submission_files.map((file) => file.path).sort()).toEqual([
    "empty.txt",
    "main.c",
  ]);
  const main = metadata.submission_files.find((file) => file.path === "main.c")!;
  expect(await (form.get(main.part) as File).text()).toBe(source);

  await page.setViewportSize({ width: 1584, height: 992 });
  await page.screenshot({ path: "test-results/validation-results.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/validation-results-mobile.png", fullPage: true });
  await page
    .getByRole("navigation", { name: "結果の課題絞り込み" })
    .locator(`a[href*="project_id=${project_id}"]`)
    .click();
  await expect(page).toHaveURL(new RegExp(`project_id=${project_id}`));
  await page.getByLabel("全体結果").click();
  await page.getByRole("option", { name: "AC", exact: true }).click();
  await expect(page).toHaveURL(/status=AC/);
  await page.reload();
  await expect(page.getByLabel("全体結果")).toHaveText("AC");
  await page.getByLabel("全体結果").click();
  await page.getByRole("option", { name: "すべて", exact: true }).click();
  await expect(row).toBeVisible();
});

test("browse Validation detail, expand Steps, switch Workflows and download submitted files", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByLabel("User ID", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("admin");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  const imported = await page.request.post("/api/admin/resource-imports", {
    data: { resource_id: "ex1", version: "v1.0.0" },
  });
  expect(imported.status(), await imported.text()).toBe(200);
  const { project_id } = await imported.json();
  await page.goto(`/projects/${project_id}`);
  await page.getByRole("button", { name: "サンプル提出", exact: true }).click();
  const { fileURLToPath } = await import("node:url");
  await page
    .getByLabel("提出ファイル", { exact: true })
    .setInputFiles(
      ["Makefile", "gcd_euclid.c", "gcd_recursive.c", "main_euclid.c", "main_recursive.c"].map(
        (path) => fileURLToPath(new URL(`../fixtures/validation-ex1/${path}`, import.meta.url)),
      ),
    );
  const creation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/projects/${project_id}/validation`),
  );
  await page.getByRole("button", { name: "提出する", exact: true }).click();
  const created: components["schemas"]["CreatedRequest"] = await (await creation).json();
  await page.getByRole("link", { name: `Validation Result ${created.id}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/results/${created.id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `Validation Result #${created.id}`,
  );
  const submission = page.getByRole("region", { name: "提出ファイル", exact: true });
  await expect(submission.getByLabel("提出ファイルのファイル")).toBeVisible();
  await submission.getByLabel("提出ファイルのファイル").selectOption({ label: "Makefile" });
  await expect(submission.locator("pre")).toContainText("gcd_euclid");
  const downloadEvent = page.waitForEvent("download");
  await submission.getByRole("button", { name: "一括ダウンロード" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(`submission-${created.id}.zip`);
  expect(await download.failure()).toBeNull();
  await expect(page.getByText("実行完了", { exact: true })).toBeVisible({ timeout: 90_000 });
  const response = await page.request.get(`/api/requests/${created.id}/validation`);
  const detail: components["schemas"]["ValidationDetail"] = await response.json();
  expect(detail.status).toBe("AC");
  const first = detail.result!.workflows[0];
  const second = detail.result!.workflows[1];
  const job = first.jobs.find((job) => job.steps.some((step) => step.expected.stdout))!;
  const step = job.steps.find((step) => step.expected.stdout)!;
  await page
    .getByRole("table", { name: `${job.name} のStep結果`, exact: true })
    .getByRole("button", { name: `${step.name} の詳細`, exact: true })
    .click();
  await expect(
    page.getByText(`Exit code: ${step.exit_code} (expected: ${step.expected.exit_code})`, {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Diff View", exact: true }).first().click();
  await expect(page.getByText("行位置ごとの差分です。空白を含めて比較しています。")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "プリセットファイル", exact: true }).locator("pre"),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.screenshot({ path: "test-results/validation-detail.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/validation-detail-mobile.png", fullPage: true });
  const workflows = page.getByRole("navigation", { name: "結果のワークフロー" });
  await workflows.getByRole("link", { name: `${second.name} AC`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`workflow=${second.id}`));
  await page.reload();
  await expect(
    workflows.getByRole("link", { name: `${second.name} AC`, exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "課題説明に戻る", exact: true }).click();
  await expect(page).toHaveURL(new URL(`/projects/${project_id}`, page.url()).href);
  await expect(
    page.getByRole("heading", { level: 1, name: first.name, exact: true }),
  ).toBeVisible();
});
