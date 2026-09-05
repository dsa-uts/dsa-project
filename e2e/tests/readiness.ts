import { expect } from '@playwright/test'
import { apiBaseURL } from '../environment.js'

export async function waitForDeployment() {
  await expect(async () => {
    const [frontendResponse, healthResponse] = await Promise.all([
      fetch(new URL('/', apiBaseURL)),
      fetch(new URL('/health', apiBaseURL)),
    ])
    expect(frontendResponse.status).toBe(200)
    expect(healthResponse.status).toBe(200)
  }).toPass({ timeout: 240_000 })
}
