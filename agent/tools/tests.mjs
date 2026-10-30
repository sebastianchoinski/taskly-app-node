import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { run } from './sandbox.mjs';

export const PROJECTS = ['backend', 'frontend'];

export const isTestFile = (file) =>
  /^backend\/tests\/.+\.test\.ts$/.test(file) || /^frontend\/src\/.+\.test\.tsx?$/.test(file);

export const isSourceFile = (file) =>
  /^(backend|frontend)\/src\/.+\.tsx?$/.test(file) && !isTestFile(file) && !file.startsWith('frontend/src/test/');

export const projectOf = (file) => PROJECTS.find((project) => file.startsWith(`${project}/`));

export function groupByProject(files) {
  const groups = {};
  for (const file of files) (groups[projectOf(file)] ??= []).push(file);
  delete groups.undefined;
  return groups;
}

const shellQuote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;
const firstLines = (text, count = 6) => text.split('\n')
  .filter((line) => line.trim() && (!/^\s*at /.test(line) || /\.test\.tsx?:/.test(line)))
  .slice(0, count).join('\n');

let runCounter = 0;

// Runs the given test files of one project and returns one entry per test case.
// `crashed` means Vitest produced no report at all (infrastructure problem, not a test result).
export function runTests(workspace, project, files) {
  const report = `.skeptic/runs/${project}-${process.pid}-${++runCounter}.json`;
  mkdirSync(path.join(workspace, '.skeptic/runs'), { recursive: true });
  const filters = files.map((file) => shellQuote(path.relative(project, file))).join(' ');
  const result = run(workspace, project,
    `./node_modules/.bin/vitest run ${filters} --reporter=json --outputFile=${shellQuote(`../${report}`)}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path.join(workspace, report), 'utf8'));
  } catch {
    return { crashed: true, timedOut: result.timedOut, output: result.output.slice(-4000), tests: [] };
  }
  return { crashed: false, timedOut: false, output: '', tests: parseVitestReport(parsed, result.root) };
}

export function parseVitestReport(report, root) {
  return report.testResults.flatMap((suite) => {
    const file = path.relative(root, suite.name);
    if (suite.assertionResults.length === 0) {
      return [{ file, name: '(file failed to load)', title: '', status: 'failed', loadError: true, message: firstLines(suite.message ?? '') }];
    }
    return suite.assertionResults.map((test) => ({
      file,
      name: test.fullName,
      title: test.title,
      status: test.status,
      loadError: false,
      message: firstLines((test.failureMessages ?? []).join('\n')),
    }));
  });
}

export function typecheck(workspace, project) {
  const result = run(workspace, project, './node_modules/.bin/tsc --noEmit');
  return { ok: result.code === 0, output: result.output.slice(-4000) };
}

// Only the frontend enforces a formatter; returns the files Prettier would change.
export function formatProblems(workspace, project, files) {
  if (project !== 'frontend') return [];
  const result = run(workspace, project,
    `./node_modules/.bin/prettier --list-different ${files.map((file) => shellQuote(path.relative(project, file))).join(' ')}`);
  return result.code === 0 ? [] : result.output.split('\n').filter((line) => line.trim()).map((file) => `frontend/${file.trim()}`);
}

export function install(workspace, project) {
  const result = run(workspace, project, 'npm ci --no-audit --no-fund', { network: true, timeoutSeconds: 900 });
  if (result.code !== 0) throw new Error(`npm ci failed in ${project}:\n${result.output.slice(-2000)}`);
}
