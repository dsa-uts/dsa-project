import { expect } from '@playwright/test'
import { baseURL } from './environment.js'

export default async function waitForDeployment() {
  // Pod readiness can precede the Ingress controller's endpoint update after reset.
  await expect(async () => {
    await Promise.all(['/', '/health'].map(async path => {
      const url = new URL(path, baseURL)
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
      await response.body?.cancel()
      expect(response.status, `${url} must be ready before running E2E tests`).toBe(200)
    }))
  }).toPass({ timeout: 120_000, intervals: [250, 500, 1_000] })
}
