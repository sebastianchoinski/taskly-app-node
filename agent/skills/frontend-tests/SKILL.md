---
name: frontend-tests
description: Conventions for unit tests of the Taskly frontend (React 19, TanStack Query 5, styled-components, Vitest, Testing Library). Use before writing or editing frontend test files.
---

# Frontend unit tests

- Location: next to the source, `<Name>.test.tsx` or `<name>.test.ts`.
- Style (Prettier): no semicolons, single quotes, explicit imports from `vitest`. Environment is
  jsdom; `src/test/setup.ts` already loads jest-dom matchers and cleans up after each test.
- Shared data: `todoFixture` from `src/test/todoFixture.ts`. Spread and override it.

## Choosing the boundary

| Code | How to test |
| --- | --- |
| Components | `render` + `screen` queries by role or visible text + `userEvent.setup()`. Replace the design system with `vi.mock('<relative path>/design-system', () => import('<relative path>/design-system/mocks'))` like the existing tests do. Assert what the user sees and which callbacks fired. |
| `lib/http.ts` | Stub `fetch` with `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(...)))`, restore with `vi.unstubAllGlobals()`. Cover status codes, non-JSON error bodies, network errors, aborted requests. |
| `features/todos/api/*` | Mock `request` from `lib/http` (see `api/todos.test.ts`) and assert the path, method and body. |
| Query/mutation hooks | `renderHook` with a wrapper: `new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })` inside `QueryClientProvider`. Mock `todosApi`. Seed the cache with `client.setQueryData(todoKeys.list, [...])` and assert the cache after `await act(() => result.current.mutateAsync(...))`. |
| `utils/*` | Plain function calls, `it.each` for tables. Freeze "today" with `vi.useFakeTimers()` + `vi.setSystemTime(...)` when dates matter, and restore real timers. |

## Things that bite

- Query hooks are async: use `await waitFor(...)` or `findBy*`, never fixed sleeps.
- One `QueryClient` per test — a shared one leaks cache between tests.
- Query by role/text, not by class names or styled-components internals.
