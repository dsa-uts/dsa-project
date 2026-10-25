import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
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
      name: "default",
      testIgnore: ["**/problem-registration.spec.ts", "**/problem-submission.spec.ts"],
    },
    {
      name: "register",
      testMatch: "**/problem-registration.spec.ts",
    },
    {
      name: "submit",
      testMatch: "**/problem-submission.spec.ts",
      dependencies: ["register"],
    },
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
