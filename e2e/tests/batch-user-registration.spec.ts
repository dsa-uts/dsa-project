import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("adminがCSVで3人を一括登録し、ダウンロードしたパスワードで全員ログインできる", async ({
  page,
}) => {
  page.on("response", (response) => {
    if (["xhr", "fetch"].includes(response.request().resourceType())) {
      const isRegistration =
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/admin/register");
      expect
        .soft(response.status(), `${response.request().method()} ${response.url()}`)
        .toBe(isRegistration ? 201 : 200);
    }
  });

  await page.goto("/login");
  await page.getByLabel("ユーザーID").fill(process.env.E2E_ADMIN_USER_ID ?? "admin");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill(process.env.E2E_ADMIN_PASSWORD ?? "adminPassword");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL("/about");
  await page.getByRole("link", { name: "Admin", exact: true }).click();
  await page.getByRole("link", { name: "Batch User Registration", exact: true }).click();
  await page
    .getByLabel("Choose File")
    .setInputFiles(fileURLToPath(new URL("../data/userdata.csv", import.meta.url)));

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Register", exact: true }).click(),
  ]);
  const csv = await readFile(await download.path(), "utf8");
  // shortcut: このfixtureには引用符・セル内のカンマや改行がない。追加する場合はCSVパーサーを使う。
  const [header, ...rows] = csv
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(","));
  const userIdIndex = header.indexOf("user_id");
  const passwordIndex = header.indexOf("password");
  expect(userIdIndex).toBeGreaterThanOrEqual(0);
  expect(passwordIndex).toBeGreaterThanOrEqual(0);
  expect(rows.map((row) => row[userIdIndex])).toEqual(["202600001", "202600002", "202600003"]);

  for (const row of rows) {
    await test.step(`${row[userIdIndex]}でログイン`, async () => {
      await page.getByRole("button", { name: "Logout", exact: true }).click();
      await expect(page).toHaveURL("/login");
      await page.getByLabel("ユーザーID").fill(row[userIdIndex]);
      await page.getByLabel("パスワード", { exact: true }).fill(row[passwordIndex]);
      await page.getByRole("button", { name: "ログイン", exact: true }).click();
      await expect(page).toHaveURL("/about");
    });
  }
});
