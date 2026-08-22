import { defineConfig } from '@playwright/test'
import { baseURL } from './environment.js'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  outputDir: '/tmp/dsa-e2e-test-results',
  use: {
    baseURL,
  },
})
