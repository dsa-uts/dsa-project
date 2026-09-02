import { defineConfig } from '@playwright/test'
import { apiBaseURL } from './environment.js'

const browserHostTarget = process.env.E2E_BROWSER_HOST_TARGET

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  outputDir: '/tmp/dsa-e2e-test-results',
  use: {
    baseURL: apiBaseURL,
    launchOptions: browserHostTarget
      ? { args: [`--proxy-server=${browserHostTarget}`, '--proxy-bypass-list=<-loopback>'] }
      : undefined,
  },
})
