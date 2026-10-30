# Skeptic

A green unit test does not mean the test is useful. `expect(true).toBe(true)` is green too.

Skeptic is a unit-test agent for this Taskly app. It reads a pull request, writes tests, and then tries to prove those tests are worthless. Only tests that survive that check are offered to the author, in a separate pull request. The author merges or closes it. Skeptic never commits onto the author's branch.

## Why it is built this way

The interesting part is not "call a model and hope". The model is replaceable. What this repository owns is the part a language model will not do honestly on its own:

**Time travel.** After the tests pass on the new code, the same tests run again with the modified application files reverted to the merge base. A test that still passes did not notice this change.

**Sabotage.** Time travel cannot cover brand-new files or tests of old behaviour. For those, the agent must name a one-line edit of application code that should make the test fail (`find` must match exactly once). A script, not the model, applies that edit and checks.

Each test then gets a verdict:

- 🛡️ **guards** — passes on the new code, fails under time travel or sabotage
- 📘 **documents** — passes in every experiment, so it does not prove anything
- ❌ **broken** — fails on the new code. One broken test, and nothing is proposed.

**Promises, not file lists.** Before it writes tests, the agent states in plain language what the change claims to do. The pull request comment is a table: promise → test → verdict → evidence.

**A stacked pull request.** Results land on `skeptic/pr-<n>`, aimed at the feature branch. There is one sticky comment per pull request (`<!-- skeptic-report -->`), edited in place.

**The model is untrusted.** It may only edit test files. The only shell command it may run is `agent/tools/check.mjs`, which typechecks, runs the named tests in Docker (`--network none`, no host environment, read-only root), and runs the path guard. Agent code comes from the base branch, not from the pull request. The job that holds a write token never executes pull-request code: it re-reads the patch, rejects anything that is not a test file, then publishes.

Fork pull requests are skipped. `pull_request_target` is not used.

## Layout

```text
agent/
  agents/skeptic.md          role, attitude, hard rules
  skills/*/SKILL.md          triage, risk map, backend/frontend conventions, proving, reporting
  tools/check.mjs            the only command the model may run
  tools/prove.mjs            time travel + sabotages → verdicts
  tools/guard.mjs            test paths only; no deletes, no .only/.skip
  tools/sandbox.mjs          Docker, no network, no host env
  run.mjs                    triage → workspace → model → guard → prove → report
  publish.mjs                re-check the patch, open the tests PR, upsert the comment
  runtimes.mjs               gemini (default), claude, fixture (no model, for plumbing tests)
.github/workflows/
  ci.yml                     typecheck and coverage for both apps, plus agent unit tests
  skeptic.yml                agent job (read-only) → publish job (write, no PR code)
```

Skills are ordinary `SKILL.md` files, written for this codebase (Vitest, the fake `TodoStore`, the frontend design-system mocks, 204 on DELETE, and so on). Gemini CLI loads them with `activate_skill`; Claude Code can load the same directory as a plugin.

## How a pull request is handled

1. Cheap triage in code: if the diff does not touch `backend/` or `frontend/` application code, stop. No model call.
2. Otherwise the model picks one of: skip, check-only, write tests, regression test.
3. It writes tests in the project style, runs `check` at most twice to repair them, and writes `.skeptic/claims.json`.
4. `prove` re-runs everything and assigns verdicts. `guard` rejects source edits, deletions, `.only` / `.skip`, and leaked secrets.
5. Status `proposed` produces `tests.patch`. Anything else (including a single ❌) produces nothing to merge; a candidate patch may still be stored as an artifact.

Label `skip-test-agent` turns the workflow off for that pull request.

## Running it

Needs Node 22 (see `.nvmrc`), Docker, and [Gemini CLI 0.66](https://www.npmjs.com/package/@google/gemini-cli). Copy `.env.agent.example` to `.env.agent` and set `GEMINI_API_KEY`.

```sh
# Plumbing, no API key
SKEPTIC_RUNTIME=fixture SKEPTIC_FIXTURE=agent/fixtures/prove-demo \
  node agent/run.mjs --base main --head scratch/prove-demo --out .skeptic/e2e-good

# Against a real branch
node --env-file=.env.agent agent/run.mjs --base main --head <branch> --out .skeptic/live

# Existing code, no pull request
node --env-file=.env.agent agent/run.mjs --mode coverage --head main \
  --targets frontend/src/features/todos/utils/todos.ts --out .skeptic/cover
```

`agent/tools/` unit tests: `node --test 'agent/**/*.test.mjs'`.

On GitHub, set repository secret `GEMINI_API_KEY`. Optional variables: `SKEPTIC_MODEL`, `SKEPTIC_MAX_TURNS` (default 80), `SKEPTIC_RUNTIME=claude` plus `ANTHROPIC_API_KEY` if you switch. The workflow must be allowed to create pull requests (Settings → Actions → General).

The default model is `gemini-3.5-flash-lite` because the Gemini free tier is tight (full Flash models are ~20 requests/day; one agent run uses about that many). A paid key can set `SKEPTIC_MODEL` to a larger model. Quality of the tests follows the model; the barriers and the proof step do not.

## What it has actually done

Application unit tests were extended on `main` for the previously untested routes, config, app wiring, HTTP client and mutation hooks. Line coverage moved roughly:

| | Tests | Lines |
| --- | ---: | ---: |
| Backend | 48 → 71 | 33% → 78% |
| Frontend | 18 → 31 | 48% → 66% |

Those tests were written to the same skills the agent uses and run through `prove` (34 sabotages, all caught). `lifespan.ts` was left alone: process start/stop wants an integration test with a real database.

Live Gemini runs, same scripts that GitHub Actions would call:

| Input | Result |
| --- | --- |
| Demo branch with a friendlier 404 and `postgres://` URLs | `proposed`: 5 tests, 3 🛡️ (time travel), 2 📘 |
| Coverage mode on five untested frontend files | `proposed`: 9 tests, 5 🛡️, 4 📘 |
| [#1 Overdue tasks](https://github.com/sebastianchoinski/taskly-app-node/pull/1) | `proposed`: filter, header copy, `GET /api/todos/summary` |
| [#2 README only](https://github.com/sebastianchoinski/taskly-app-node/pull/2) | `skipped` in code, no model call |

On the overdue run the agent also declared a sabotage that caught nothing. That test was marked 📘 instead of dressed up as coverage. That is the point of the proof step.

GitHub Actions on this account is currently locked (billing), so the workflows are in the repo but the hosted runners do not start. The same `run.mjs` / `publish.mjs` path works locally; that is how the comments and stacked test PRs are produced until Actions is unlocked.

## Assumptions

- The agent proposes; a person merges. Nothing is auto-merged.
- Unit tests only: fake `TodoStore` and mocked `fetch`. No real database, no network from tests.
- Existing tests are not deleted. The agent may append to a file.
- Results are advisory. Ordinary CI can still block a merge; Skeptic does not.
- People with write access to the repo are trusted (they could change the workflow). What we actually defend against is prompt injection in the PR body, a malicious dependency, and a model that edits the wrong file.

## Limits

- The proof is only as good as the sabotages and the files time travel reverts. A test can still be thin and get 🛡️ if the sabotage is well chosen.
- `it.each` titles in the source are templates; Vitest reports concrete names. Matching those up is heuristic.
- Gemini CLI will load `.gemini/`, `.agents/` and `GEMINI.md` from the project it runs in, so a pull request that adds those is refused rather than allowed to reconfigure the agent.
- The free Gemini tier is the wrong size for a heavy model. Flash-Lite forgets sabotages more often; the report shows that instead of hiding it.
- Hosted GitHub Actions is blocked on this account until the billing lock is cleared. Unlocking it should not need code changes.

## If this went further

- Paid model, so a typical run can use something stronger than Flash-Lite without burning the daily quota.
- Persist the sticky comment identity on local publishes the same way as on `github-actions[bot]`.
- Cover `lifespan.ts` with a short integration test against Postgres in Compose, outside this agent.
- A second check that the stacked tests PR still passes after the author pushes, before it is merged.
- Swap `runtimes.mjs` for another CLI; keep `check`, `prove`, `guard` and `publish`.
