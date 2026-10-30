import { afterEach, expect, it, vi } from 'vitest'
import { request } from './http'

const respond = (status: number, body?: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(body === undefined ? null : JSON.stringify(body), { status }),
    ),
  )

afterEach(() => vi.unstubAllGlobals())

it('tells the user that a deleted task no longer exists', async () => {
  respond(404, { detail: 'Task not found.' })
  await expect(request('/todos/1')).rejects.toThrow(
    'This task no longer exists. Refresh the list.',
  )
})

it('returns nothing for 204 No Content', async () => {
  respond(204)
  await expect(
    request('/todos/1', { method: 'DELETE' }),
  ).resolves.toBeUndefined()
})

it('exports a request function', () => {
  expect(typeof request).toBe('function')
})
