import { defineConfig } from '@playwright/test'
import { baseURL } from './environment.js'

const outage = process.env.E2E_AUTH_OUTAGE === '1'

export default defineConfig({
  testDir: './tests',
  testMatch: outage ? '**/auth-outage.spec.ts' : '**/*.spec.ts',
  testIgnore: outage ? [] : ['**/auth-outage.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['line'], ['html', { outputFolder: `playwright-report/${outage ? 'outage' : 'normal'}`, open: 'never' }]],
  outputDir: `test-results/${outage ? 'outage' : 'normal'}`,
  use: {
    baseURL,
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
