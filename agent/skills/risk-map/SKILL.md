---
name: risk-map
description: Choose which existing, untested code deserves tests first, by what would hurt users most if it broke. Use in coverage mode instead of triage-change.
---

# Map the risks before chasing coverage

`.skeptic/task.md` lists target files and their current coverage. Do not aim for 100%. Rank what
could break, by user impact:

1. **Data loss or a wrong write** — deleting or updating the wrong task, a lost field, an update that
   silently does nothing (404 vs 204 handling, `updateManyAndReturn` returning nothing).
2. **A user stuck without feedback** — error messages, 422 validation paths, network failures,
   aborted requests, cache not updated after a mutation.
3. **Startup and configuration** — building the database URL, missing variables, special characters.
4. **Cosmetics** — empty states, labels.

Write tests from the top of the list down and stop when the remaining items are cosmetic or you
run out of turns. For each target you skip, give one sentence why.

Each risk becomes a promise, phrased as the behaviour that protects the user, e.g. "A failed
connection tells the user to try again instead of showing a raw TypeError."

There is no "before" version in coverage mode, so every test needs a declared sabotage (see `prove-it`).
