---
name: backend-tests
description: Conventions for unit tests of the Taskly backend (Express 5, Prisma 7, Zod, Vitest, Supertest). Use before writing or editing files in backend/tests.
---

# Backend unit tests

- Location: `backend/tests/<area>.test.ts`. Vitest only picks up `tests/**/*.test.ts`.
- Style: semicolons, single quotes, explicit imports from `vitest`, imports of source files **with
  the `.ts` extension**: `import { createTodosRouter } from '../src/features/todos/router.ts';`
- Shared data: `backend/tests/fixture.ts` exports `record` (a Prisma row) and `todo` (the API shape).
  Reuse them; spread and override instead of writing new objects from scratch.

## Choosing the boundary

| Code | How to test |
| --- | --- |
| `features/todos/router.ts`, `api/health.ts`, `factory.ts` | Build a tiny Express app with `express.json()`, mount the router with a fake store made of `vi.fn()` (see `router.test.ts`), call it with `supertest`. Assert status **and** body **and** what the store was called with. |
| `features/todos/repository.ts`, `core/database.ts` | `createDatabase('postgresql://test:test@localhost:5432/test')` and `vi.spyOn(database.todo, '<method>')`. Nothing connects as long as every used method is mocked. |
| `core/config.ts` | Call `resolveDatabaseUrl` directly; control variables with `vi.stubEnv` and `vi.unstubAllEnvs()` in `afterEach`. Set `DATABASE_URL` to `''` when testing the fallback. |
| `validators.ts`, `mappers.ts` | Plain function calls; `it.each` tables for many inputs. These files have a 100% per-file coverage threshold — keep it. |
| `core/lifespan.ts`, `main.ts` | Usually not worth unit tests (process wiring). Say so instead of mocking half of Node. |

## Things that bite

- The router returns 422 with `{ detail: <zod issues> }` for invalid bodies and invalid ids
  (`/api/todos/abc`), and 404 with `{ detail: 'Task not found.' }` for missing tasks.
- `DELETE` answers `204` with an empty body; assert `res.text === ''` or `res.body` is `{}`.
- Express 5 forwards rejected promises to the error handler — test it by making the fake store reject.
