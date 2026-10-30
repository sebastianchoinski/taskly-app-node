import { afterEach, expect, it, vi } from 'vitest'
import { request } from './http'

function respondWith(response: Response) {
  const fetch = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function failWith(error: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status })

afterEach(() => vi.unstubAllGlobals())

it('sends JSON to the API and returns the parsed body', async () => {
  const fetch = respondWith(json(200, { id: 1 }))
  await expect(
    request('/todos', { method: 'POST', headers: { 'X-Trace': 'abc' } }),
  ).resolves.toEqual({ id: 1 })
  expect(fetch).toHaveBeenCalledWith('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Trace': 'abc' },
  })
})

it('returns nothing for 204 No Content', async () => {
  respondWith(new Response(null, { status: 204 }))
  await expect(
    request('/todos/1', { method: 'DELETE' }),
  ).resolves.toBeUndefined()
})

it('explains validation errors (422) in plain words', async () => {
  respondWith(json(422, { detail: [{ path: ['title'] }] }))
  await expect(request('/todos')).rejects.toThrow(
    'Check the task details: title up to 120 characters',
  )
})

it('shows the server message for other errors', async () => {
  respondWith(json(404, { detail: 'Task not found.' }))
  await expect(request('/todos/9')).rejects.toThrow('Task not found.')
})

it('falls back to a generic message when the error body is not JSON', async () => {
  respondWith(new Response('<html>Bad gateway</html>', { status: 502 }))
  await expect(request('/todos')).rejects.toThrow(
    'The operation failed. Please try again.',
  )
})

it('turns network failures into a friendly message', async () => {
  failWith(new TypeError('Failed to fetch'))
  await expect(request('/todos')).rejects.toThrow(
    'Cannot connect to the server. Please try again.',
  )
})

it('rethrows an aborted request untouched so callers can ignore it', async () => {
  const controller = new AbortController()
  controller.abort()
  const abort = new DOMException('The operation was aborted.', 'AbortError')
  failWith(abort)
  await expect(request('/todos', { signal: controller.signal })).rejects.toBe(
    abort,
  )
})
