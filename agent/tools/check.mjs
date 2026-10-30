// The only command the agent is allowed to run: `node agent/tools/check.mjs <test files...>`
// from the workspace root. It typechecks and runs the given tests inside the sandbox.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { checkChanges, collectChanges, findSecrets } from './guard.mjs';
import { formatProblems, groupByProject, isTestFile, runTests, typecheck } from './tests.mjs';

const workspace = process.cwd();
const files = process.argv.slice(2).map((file) => path.normalize(file));
const rejected = files.filter((file) => !isTestFile(file) || !existsSync(path.join(workspace, file)));
if (!files.length || rejected.length) {
  console.log(`Usage: check.mjs <test files...>. Not existing test files: ${rejected.join(', ') || '(none given)'}`);
  process.exit(2);
}

let ok = true;
for (const [project, projectFiles] of Object.entries(groupByProject(files))) {
  const types = typecheck(workspace, project);
  const relevant = types.output.split('\n').filter((line) => projectFiles.some((file) => line.includes(path.relative(project, file))));
  console.log(types.ok ? `✓ typecheck ${project}` : `✗ typecheck ${project}\n${(relevant.length ? relevant : [types.output]).join('\n')}`);
  ok &&= types.ok;
  for (const file of formatProblems(workspace, project, projectFiles)) {
    console.log(`! ${file}: not formatted with the project's Prettier config (style only, fix it)`);
  }

  const run = runTests(workspace, project, projectFiles);
  if (run.crashed) {
    console.log(`✗ ${project}: the test run crashed${run.timedOut ? ' (timeout)' : ''}\n${run.output}`);
    ok = false;
    continue;
  }
  for (const test of run.tests) {
    console.log(`${test.status === 'passed' ? '✓' : '✗'} ${test.file} › ${test.name}`);
    if (test.status !== 'passed') console.log(`    ${test.message.split('\n').join('\n    ')}`);
    ok &&= test.status === 'passed';
  }
}

const changes = collectChanges(workspace);
const problems = [...checkChanges(changes), ...findSecrets(changes)];
for (const problem of problems) console.log(`✗ guard: ${problem}`);
process.exitCode = ok && !problems.length ? 0 : 1;
