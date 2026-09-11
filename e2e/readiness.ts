import { expect } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { baseURL } from './environment.ts'

export default async function waitForDeployment() {
  // Pod readiness can precede the Ingress controller's endpoint update after reset.
  await expect(async () => {
    await Promise.all(['/', '/health', '/api/me'].map(async path => {
      const url = new URL(path, baseURL)
      // A present, unknown token exercises the DB and returns 401 when it is
      // reachable; a missing cookie would bypass the DB entirely.
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5_000),
        headers: path === '/api/me' ? { Cookie: '__Host-dsa_session=readiness-probe' } : {},
      })
      await response.body?.cancel()
      expect(response.status, `${url} must be ready before running E2E tests`).toBe(path === '/api/me' ? 401 : 200)
    }))
  }).toPass({ timeout: 120_000, intervals: [250, 500, 1_000] })
}

// Node 24 executes this same probe before and after the shell-managed outage.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await waitForDeployment()
}
