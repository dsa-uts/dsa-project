import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test.use({ timezoneId: "Asia/Tokyo" });

test("adminが3人分を一括採点すると全課題がACになり提出時刻が保持される", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/login");
  await page.getByLabel("ユーザーID").fill(process.env.E2E_ADMIN_USER_ID ?? "admin");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill(process.env.E2E_ADMIN_PASSWORD ?? "adminPassword");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL("/about");

  await page.getByRole("link", { name: "Grading", exact: true }).click();
  await page.getByRole("link", { name: "Grading Request (一括提出)", exact: true }).click();
  await page.getByRole("combobox").selectOption({ label: "1. 課題1" });
  await page
    .locator('input[type="file"]')
    .setInputFiles(fileURLToPath(new URL("../data/report-class1.zip", import.meta.url)));
  await page.getByRole("button", { name: "Submit (3 件)", exact: true }).click();
  await expect(page.getByText("3 succeeded. (rate: 100%)", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Grading", exact: true }).click();
  await page.getByRole("link", { name: "Grading Results (採点結果一覧)", exact: true }).click();
  await page.getByRole("combobox").selectOption({ label: "1: 課題1" });

  for (const [name, timestamp] of [
    ["サンプルユーザー1", "2026-10-11 13:52:49"],
    ["サンプルユーザー2", "2026-10-12 13:52:49"],
    ["サンプルユーザー3", "2026-10-13 13:52:49"],
  ]) {
    await test.step(`${name}の採点結果と提出時刻`, async () => {
      const row = page
        .getByRole("row")
        .filter({ has: page.getByRole("link", { name: `${name} (` }) });
      const submittedAt = new RegExp(`^${timestamp}\\s*(?:\\(Late\\))?$`);
      await expect(row.locator("td:not(:first-child)").getByRole("link")).toHaveText(
        ["AC", submittedAt, "AC", submittedAt],
        { timeout: 60_000 },
      );
    });
  }
});
