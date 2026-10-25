import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("adminが課題1にZIPを2件登録するとDashboardに基本課題と発展課題が表示される", async ({
  page,
}) => {
  const waitFor200 = async (method: string, path: string) => {
    const response = await page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith(path) && response.request().method() === method,
    );
    expect(response.status()).toBe(200);
  };

  await page.goto("/login");
  await page.getByLabel("ユーザーID").fill(process.env.E2E_ADMIN_USER_ID ?? "admin");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill(process.env.E2E_ADMIN_PASSWORD ?? "adminPassword");
  await Promise.all([
    waitFor200("POST", "/user/login"),
    page.getByRole("button", { name: "ログイン", exact: true }).click(),
  ]);
  await page.getByRole("link", { name: "Admin", exact: true }).click();
  await Promise.all([
    waitFor200("GET", "/problem/fetch/list"),
    page.getByRole("link", { name: "Problem Registration", exact: true }).click(),
  ]);

  const lectureTable = page.locator("table").first();
  await lectureTable.locator(":scope > tbody > tr").last().getByRole("button").click();
  await page.getByPlaceholder("ID", { exact: true }).fill("1");
  await page.getByPlaceholder("Title", { exact: true }).fill("課題1");
  await Promise.all([
    waitFor200("PUT", "/problem/crud/create"),
    waitFor200("GET", "/problem/fetch/list"),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await page.getByRole("cell", { name: "課題1", exact: true }).click();

  const problemTable = lectureTable.locator("table");
  for (const problemId of [1, 2]) {
    await problemTable.getByRole("button", { name: "", exact: true }).click();
    await problemTable.getByPlaceholder("ID", { exact: true }).fill(String(problemId));
    await problemTable
      .locator('input[type="file"]')
      .setInputFiles(fileURLToPath(new URL(`../data/ex1-${problemId}.zip`, import.meta.url)));
    await Promise.all([
      waitFor200("POST", `/problem/crud/create/1/${problemId}`),
      waitFor200("GET", "/problem/fetch/list"),
      problemTable.getByRole("button", { name: "Add", exact: true }).click(),
    ]);
  }

  await Promise.all([
    waitFor200("GET", "/problem/fetch/list"),
    page.getByRole("link", { name: "Dashboard", exact: true }).click(),
  ]);
  await page.getByRole("button", { name: "課題1", exact: true }).click();
  await expect(page.getByRole("heading", { name: "課題1", exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("link", { name: "基本課題", exact: true })
      .and(page.locator('[href$="/problem/1/1"]')),
  ).toBeVisible();
  await expect(
    page
      .getByRole("link", { name: "発展課題", exact: true })
      .and(page.locator('[href$="/problem/1/2"]')),
  ).toBeVisible();
});
