---
name: triage-change
description: Decide whether a pull request needs new or updated unit tests, and list the promises the change makes. Use first, in pr mode.
---

# Triage a change

Read the diff in `.skeptic/task.md` and the changed files in full. Pick exactly one decision:

| Decision | When | What happens next |
| --- | --- | --- |
| `skip` | No behaviour can change: docs, comments, formatting, styles only, Storybook stories, config that tests do not exercise. | Stop. Explain in one sentence. |
| `check-only` | Behaviour should stay the same: renames, extracted functions, refactors already covered by tests. | Run the existing tests of the touched area with the check command. Write nothing new unless you find an unprotected branch. |
| `write-tests` | New behaviour: a new endpoint, field, filter, component state, error message. | Write tests for each promise. |
| `regression-test` | A bug fix. | Write a test that reproduces the bug. It must fail on the code before the PR — the time-travel check will verify that. |

Then list the **promises** of the change: 2–6 short sentences a product person would agree with,
each describing observable behaviour, e.g. "Deleting a task that no longer exists shows: This task
no longer exists." Not: "Calls `request` with 404 handling."

Good promises are about inputs and outputs at a boundary (HTTP response, rendered text, returned value,
call to a mocked dependency). Bad promises restate the implementation.

Look for the edges the author probably did not test: empty values, the 404/422 path, the boundary
value of a limit, the `undefined` branch of an optional field, what happens on the second call.

Existing tests that the change intentionally breaks are part of the change: update them and say which
promise changed. Never weaken an assertion just to make it pass.
