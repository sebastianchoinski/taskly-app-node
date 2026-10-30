// Runs in the only job that holds a write token. It never executes code from the pull request:
// it re-checks the patch, pushes it to a separate branch, opens or updates the tests PR and the comment.
// Usage (cwd = checkout of the code under test): node agent/publish.mjs <result dir>
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MARKER, renderComment } from './report.mjs';
import { isAllowedPath } from './tools/guard.mjs';

// Independent second check: whatever happened in the agent job, only new or edited test files pass.
export function patchProblems(patch) {
  if (!patch.trim()) return ['The patch is empty.'];
  const problems = [];
  if (/^GIT binary patch/m.test(patch)) problems.push('Binary changes are not allowed.');
  if (/^(deleted file mode|rename from|rename to|old mode|new mode)/m.test(patch)) problems.push('Deletes, renames and mode changes are not allowed.');
  const paths = [...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].flatMap((match) => [match[1], match[2]]);
  if (!paths.length) problems.push('The patch touches no files.');
  for (const file of new Set(paths)) if (!isAllowedPath(file)) problems.push(`${file} is not a test file.`);
  return problems;
}

export function testsBranch({ prNumber, runId }) {
  return prNumber ? `skeptic/pr-${prNumber}` : `skeptic/coverage-${runId}`;
}

function github(token, repository) {
  return async (method, route, body) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${route}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`${method} ${route} → ${response.status} ${await response.text()}`);
    return response.status === 204 ? null : response.json();
  };
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

async function publish(resultDir, env) {
  const api = github(env.GITHUB_TOKEN, env.GITHUB_REPOSITORY);
  const [owner] = env.GITHUB_REPOSITORY.split('/');
  const prNumber = env.PR_NUMBER || null;
  const runLink = env.RUN_URL ? `[workflow run](${env.RUN_URL})` : 'local run of the same scripts (GitHub Actions unavailable)';
  const reportFile = path.join(resultDir, 'report.json');
  const report = existsSync(reportFile)
    ? JSON.parse(readFileSync(reportFile, 'utf8'))
    : { status: 'failed', mode: prNumber ? 'pr' : 'coverage', head: env.HEAD_SHA ?? '', runtime: '?', problems: [`The agent job ended without a report; see the ${runLink}.`] };

  const branch = testsBranch({ prNumber, runId: env.RUN_ID });
  const baseBranch = prNumber ? env.PR_HEAD_REF : env.DEFAULT_BRANCH;
  const [existing] = await api('GET', `/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}`);

  if (report.status === 'proposed') {
    const patch = readFileSync(path.join(resultDir, 'tests.patch'), 'utf8');
    const problems = patchProblems(patch);
    if (problems.length) {
      Object.assign(report, { status: 'rejected', problems: [...report.problems, ...problems.map((problem) => `Publisher: ${problem}`)] });
    } else {
      git('checkout', '-B', branch);
      execFileSync('git', ['apply', '--index', '-'], { input: patch });
      git('-c', 'user.name=skeptic[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit', '-m', `test: Skeptic tests for ${prNumber ? `#${prNumber}` : 'existing code'}`);
      git('push', '--force', 'origin', `HEAD:refs/heads/${branch}`);
      const title = prNumber ? `🧪 Skeptic: tests for #${prNumber}` : '🧪 Skeptic: tests for existing code';
      const body = `${renderComment({ ...report, testsPr: 'this pull request' })}\n\n---\nProposed by Skeptic in this ${runLink}. Merge to accept the tests, close to reject them.`;
      const tests = existing
        ? await api('PATCH', `/pulls/${existing.number}`, { title, body })
        : await api('POST', '/pulls', { title, body, head: branch, base: baseBranch, maintainer_can_modify: true });
      report.testsPr = tests.html_url;
    }
  }
  if (report.status !== 'proposed' && existing) {
    await api('PATCH', `/pulls/${existing.number}`, { state: 'closed' });
    await api('POST', `/issues/${existing.number}/comments`, { body: `Closed: the latest Skeptic run on the pull request did not propose tests (${runLink}).` });
  }

  if (prNumber) {
    const body = `${renderComment(report)}\n\n<sub>Details and artifacts: ${runLink}.</sub>`;
    const comments = await api('GET', `/issues/${prNumber}/comments?per_page=100`);
    const mine = comments.find((comment) => comment.user?.type === 'Bot' && comment.body?.startsWith(MARKER));
    if (mine) await api('PATCH', `/issues/comments/${mine.id}`, { body });
    else await api('POST', `/issues/${prNumber}/comments`, { body });
  }
  console.log(`${report.status}${report.testsPr ? ` → ${report.testsPr}` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await publish(path.resolve(process.argv[2]), process.env);
}
