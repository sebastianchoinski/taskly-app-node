---
name: plain-report
description: Write the machine-readable result of the run (.skeptic/claims.json) in plain, specific language for the pull request reviewer. Use last.
---

# Report in plain words

Write `.skeptic/claims.json`. The pull request comment is generated from it together with the
verified results, so reviewers will read every sentence you write here.

```json
{
  "decision": "write-tests",
  "reason": "Adds a 404-specific message to the HTTP client; nothing covered it.",
  "promises": [
    { "promise": "Deleting a task that no longer exists says so instead of a generic error.",
      "tests": ["tells the user that a deleted task no longer exists"] }
  ],
  "sabotages": [],
  "skipped": [{ "target": "backend/src/core/lifespan.ts", "why": "Process wiring; better covered by an integration test." }],
  "concerns": ["The 409 branch returns the server message verbatim, which may leak internal details."],
  "skillsUsed": ["triage-change", "frontend-tests", "prove-it", "plain-report"]
}
```

- `decision`: `skip`, `check-only`, `write-tests` or `regression-test`.
- `promises[].tests`: test titles exactly as written in `it('...')`.
- `concerns`: suspected bugs or risky code you noticed. Empty is fine; inventing is not.
- Write like a colleague in a code review: concrete, short, no hype, no "comprehensive" or "robust".
  Say what is **not** tested as clearly as what is.
