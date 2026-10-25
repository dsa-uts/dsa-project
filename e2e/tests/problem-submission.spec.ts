import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("adminが基本課題・発展課題・最終確認を提出すると15秒以内にACになる", async ({ page }) => {
  test.setTimeout(90_000);

  page.on("response", (response) => {
    if (["xhr", "fetch"].includes(response.request().resourceType())) {
      expect.soft(response.status(), `${response.request().method()} ${response.url()}`).toBe(200);
    }
  });

  await page.goto("/login");
  await page.getByLabel("ユーザーID").fill(process.env.E2E_ADMIN_USER_ID ?? "admin");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill(process.env.E2E_ADMIN_PASSWORD ?? "adminPassword");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL("/about");

  let previousResultHref: string | null = null;
  for (const submission of [
    {
      name: "基本課題",
      href: "/problem/1/1",
      endpoint: "/problem/validate/1/1",
      files: ["Makefile", "gcd_euclid.c", "main_euclid.c"],
      resultCount: 1,
    },
    {
      name: "発展課題",
      href: "/problem/1/2",
      endpoint: "/problem/validate/1/2",
      files: ["Makefile", "gcd_recursive.c", "main_recursive.c"],
      resultCount: 1,
    },
    {
      name: "[最終確認]",
      href: "/validation/batch?lectureid=1",
      endpoint: "/problem/validate/batch/1",
      files: ["example-submission.zip"],
      resultCount: 2,
    },
  ]) {
    await test.step(submission.name, async () => {
      await page.getByRole("link", { name: "Dashboard", exact: true }).click();
      await page.getByRole("button", { name: "課題1", exact: true }).click();
      await page
        .getByRole("link", { name: submission.name, exact: true })
        .and(page.locator(`[href$="${submission.href}"]`))
        .click();
      await page
        .locator('input[type="file"]')
        .setInputFiles(
          submission.files.map((file) =>
            fileURLToPath(new URL(`../data/${file}`, import.meta.url)),
          ),
        );
      await Promise.all([
        page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname.endsWith(submission.endpoint) &&
            response.request().method() === "POST",
        ),
        page.waitForResponse((response) =>
          new URL(response.url()).pathname.endsWith("/problem/result/validation/list"),
        ),
        page.getByRole("button", { name: "Submit", exact: true }).click(),
      ]);
      await expect(page).toHaveURL("/validation/results");

      const latestResult = page.locator("tbody tr").first().getByRole("link", { name: "詳細" });
      if (previousResultHref) {
        await expect(latestResult).not.toHaveAttribute("href", previousResultHref);
      }
      await expect(
        page.locator(`tbody tr:nth-child(-n+${submission.resultCount}) td:nth-child(4)`),
      ).toHaveText(Array(submission.resultCount).fill("AC"), { timeout: 15_000 });
      previousResultHref = await latestResult.getAttribute("href");
    });
  }
});
