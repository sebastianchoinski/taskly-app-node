import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ALLOWED = [
  /^backend\/tests\/[\w./-]+\.ts$/,
  /^frontend\/src\/[\w./-]+\.test\.tsx?$/,
  /^frontend\/src\/test\/[\w./-]+\.tsx?$/,
];
export const isAllowedPath = (file) => ALLOWED.some((pattern) => pattern.test(file)) && !file.split('/').includes('..');
const FOCUS_OR_SKIP = /\b(?:it|test|describe)\.(?:only|skip|todo)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(/;
export const LIMITS = { files: 8, bytesPerFile: 60_000 };

// Approximate on purpose: picks the title literal of it()/test()/it.each(...)().
export function testTitles(source) {
  const titles = new Set();
  for (const match of source.matchAll(/\b(?:it|test)(?:\.each\s*\([\s\S]*?\)\s*)?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    titles.add(match[2]);
  }
  return titles;
}

// changes: [{ path, status: 'added' | 'modified' | 'deleted', before?: string, after?: string }]
export function checkChanges(changes) {
  const problems = [];
  if (changes.length > LIMITS.files) problems.push(`Too many files changed (${changes.length} > ${LIMITS.files}).`);
  for (const change of changes) {
    const where = change.path;
    if (change.status === 'deleted') { problems.push(`${where}: deleting files is not allowed.`); continue; }
    if (!isAllowedPath(where)) { problems.push(`${where}: outside of the allowed test paths.`); continue; }
    if (Buffer.byteLength(change.after) > LIMITS.bytesPerFile) problems.push(`${where}: file is too large.`);
    if (FOCUS_OR_SKIP.test(change.after)) problems.push(`${where}: focused, skipped or todo tests are not allowed.`);
    if (change.status === 'modified') {
      const kept = testTitles(change.after);
      for (const title of testTitles(change.before)) {
        if (!kept.has(title)) problems.push(`${where}: existing test "${title}" was removed or renamed.`);
      }
    }
  }
  return problems;
}

// A prompt-injected agent could try to smuggle a credential out inside a test file.
export function findSecrets(changes, env = process.env) {
  const secrets = Object.entries(env)
    .filter(([name, value]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(name) && value && value.length >= 8);
  return changes.flatMap((change) => secrets
    .filter(([, value]) => change.after?.includes(value))
    .map(([name]) => `${change.path}: contains the value of ${name}.`));
}

const git = (workspace, ...args) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

// Everything the agent changed in the workspace compared to the commit it started from.
export function collectChanges(workspace) {
  return git(workspace, 'status', '--porcelain', '--untracked-files=all')
    .split('\n').filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2), path: line.slice(3) }))
    .filter(({ path: file }) => !file.startsWith('.skeptic/') && !file.startsWith('.claude/'))
    .map(({ code, path: file }) => {
      if (code.includes('D')) return { path: file, status: 'deleted' };
      const after = readFileSync(path.join(workspace, file), 'utf8');
      if (code === '??' || code.includes('A')) return { path: file, status: 'added', after };
      return { path: file, status: 'modified', before: git(workspace, 'show', `HEAD:${file}`), after };
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const workspace = path.resolve(process.argv[2] ?? '.');
  const changes = collectChanges(workspace);
  const problems = [...checkChanges(changes), ...findSecrets(changes)];
  console.log(problems.length ? problems.map((problem) => `✗ ${problem}`).join('\n') : '✓ Changes stay within the test files.');
  process.exitCode = problems.length ? 1 : 0;
}
