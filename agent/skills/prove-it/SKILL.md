---
name: prove-it
description: Run your tests in the sandbox, repair them, and declare sabotages that prove each test would catch a real bug. Use after writing tests and before reporting.
---

# Prove that your tests catch something

## 1. Run them

Use the check command from `.skeptic/task.md` with the test files you touched. It typechecks the
project, runs only those files in an offline sandbox, and runs the guard. A failure shows the first
lines of the assertion error. A line starting with `!` is a style warning (for example Prettier
formatting in the frontend): fix it, it does not cost a repair round.

You get **two repair rounds**. If a test still fails, decide honestly:

- the test is wrong → fix or delete *your* test,
- the application is wrong → keep the code as it is, delete the test, and describe the suspected bug
  in the report. Do not encode a bug as expected behaviour.

## 2. Know how you will be judged

After you finish, a script you do not control re-runs everything and gives each test a verdict:

- 🛡️ **guards** — passes on the new code and **fails** in at least one experiment,
- 📘 **documents** — passes in every experiment, so it does not prove anything,
- ❌ **broken** — fails on the new code. A single broken test means nothing is proposed.

Experiments:

- **Time travel** (pr mode, automatic): the modified source files are reverted to the base branch and
  your tests run again. A good test for new behaviour fails here.
- **Sabotage** (declared by you): a minimal edit of application code that your test must notice.

## 3. Declare sabotages

Declare one for every test that time travel cannot prove: tests of new files, tests of unchanged
behaviour, every test in coverage mode. Put them in `.skeptic/claims.json` (see `plain-report`):

```json
{ "testFile": "frontend/src/lib/http.test.ts", "file": "frontend/src/lib/http.ts",
  "find": "response.status === 204", "replace": "response.status === 200",
  "why": "Empty 204 responses would be parsed as JSON." }
```

- `find` must occur **exactly once** in `file`; include enough context to make it unique.
- Make it a realistic bug: flipped comparison, off-by-one limit, missing `await`, wrong status code,
  dropped field, swapped branch. Not a syntax error — a crash is not evidence.
- One sabotage can prove several tests in the same file.
- A test that no sabotage can break is a 📘. Either make the assertion sharper or remove the test.
