import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useCreateTodoMutation } from './useCreateTodoMutation'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))
beforeEach(() => vi.clearAllMocks())

const first: Todo = { ...todoFixture, id: 1, title: 'First' }
const second: Todo = { ...todoFixture, id: 2, title: 'Second' }

function renderWithCache<T>(hook: () => T, cached?: Todo[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (cached) client.setQueryData(todoKeys.list, cached)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const cache = () => client.getQueryData<Todo[]>(todoKeys.list)
  return { cache, ...renderHook(hook, { wrapper }) }
}

it('puts a created task at the top of the cached list', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(second)
  const { result, cache } = renderWithCache(useCreateTodoMutation, [first])
  await act(() => result.current.mutateAsync(second))
  expect(cache()).toEqual([second, first])
})

it('does not duplicate a created task that is already cached', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(second)
  const { result, cache } = renderWithCache(useCreateTodoMutation, [
    second,
    first,
  ])
  await act(() => result.current.mutateAsync(second))
  expect(cache()).toEqual([second, first])
})

it('starts the cached list when a task is created before the first load', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(second)
  const { result, cache } = renderWithCache(useCreateTodoMutation)
  await act(() => result.current.mutateAsync(second))
  expect(cache()).toEqual([second])
})

it('sends the update and replaces only that task in the cache', async () => {
  const updated = { ...second, completed: true }
  vi.mocked(todosApi.update).mockResolvedValue(updated)
  const { result, cache } = renderWithCache(useUpdateTodoMutation, [
    first,
    second,
  ])
  await act(() =>
    result.current.mutateAsync({ id: 2, input: { completed: true } }),
  )
  expect(todosApi.update).toHaveBeenCalledWith(2, { completed: true })
  expect(cache()).toEqual([first, updated])
})

it('removes a deleted task from the cache', async () => {
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const { result, cache } = renderWithCache(useDeleteTodoMutation, [
    first,
    second,
  ])
  await act(() => result.current.mutateAsync(1))
  expect(todosApi.remove).toHaveBeenCalledWith(1)
  expect(cache()).toEqual([second])
})

it('keeps the cache when the server refuses to delete', async () => {
  vi.mocked(todosApi.remove).mockRejectedValue(new Error('Task not found.'))
  const { result, cache } = renderWithCache(useDeleteTodoMutation, [
    first,
    second,
  ])
  await act(() =>
    expect(result.current.mutateAsync(1)).rejects.toThrow('Task not found.'),
  )
  expect(cache()).toEqual([first, second])
})
