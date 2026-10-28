import { expect, test } from "@playwright/test";

const adminUserId = process.env.E2E_ADMIN_USER_ID ?? "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "adminPassword";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("ユーザーID").fill(adminUserId);
});

test("adminでログインすると200が返り、/aboutに遷移する", async ({ page }) => {
  await page.getByLabel("パスワード", { exact: true }).fill(adminPassword);

  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/user/login") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  expect((await responsePromise).status()).toBe(200);
  await expect(page).toHaveURL("/about");
});

test("パスワードが違うと200以外が返る", async ({ page }) => {
  await page.getByLabel("パスワード", { exact: true }).fill(`${adminPassword}-wrong`);

  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/user/login") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  expect((await responsePromise).status()).not.toBe(200);
});
