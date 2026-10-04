import { expect, type APIResponse } from '@playwright/test'

export async function expectAPIError(response: APIResponse, status: number) {
  expect(response.status(), await response.text()).toBe(status)
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(response.headers()['content-type']).toContain('application/json')
  expect(await response.json()).toEqual({ code: status, message: expect.any(String) })
}
