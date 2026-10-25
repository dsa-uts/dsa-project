import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
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
  },
});
