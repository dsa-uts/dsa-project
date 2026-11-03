import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  outputDir: process.env.E2E_ARTIFACT_DIR
    ? `${process.env.E2E_ARTIFACT_DIR}/test-results`
    : "test-results",
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: process.env.E2E_ARTIFACT_DIR
          ? `${process.env.E2E_ARTIFACT_DIR}/playwright-report`
          : "playwright-report",
        open: "never",
      },
    ],
  ],
  projects: [
    {
      name: "auth",
      testMatch: "**/login.spec.ts",
    },
    {
      name: "users",
      testMatch: "**/batch-user-registration.spec.ts",
      dependencies: ["auth"],
    },
    {
      name: "register",
      testMatch: "**/problem-registration.spec.ts",
      dependencies: ["users"],
    },
    {
      name: "submit",
      testMatch: "**/problem-submission.spec.ts",
      dependencies: ["register"],
    },
    {
      name: "batch-grading",
      testMatch: "**/batch-grading.spec.ts",
      dependencies: ["submit"],
    },
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:15173",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
