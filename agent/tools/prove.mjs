import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectChanges, testTitles } from './guard.mjs';
import { groupByProject, isSourceFile, isTestFile, runTests, typecheck } from './tests.mjs';

// it.each titles are templates ('rejects %j', 'adds $a'); a reported title matches its template.
export function matchesTitle(template, title) {
  const pattern = template.split(/%[sdifjoOp#]|\$[\w.]+/)
    .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${pattern}$`, 's').test(title);
}

const git = (workspace, ...args) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

// A test only "guards" something if it actually ran and failed in an experiment.
// Failing to load (e.g. a missing import) is not evidence.
export function verdictFor(test, experiments) {
  if (test.status !== 'passed') return { verdict: 'broken', evidence: [] };
  const evidence = experiments
    .filter((experiment) => experiment.results.some((result) =>
      result.file === test.file && result.name === test.name && result.status === 'failed' && !result.loadError))
    .map((experiment) => experiment.label);
  return { verdict: evidence.length ? 'guards' : 'documents', evidence };
}

export function validateSabotage(sabotage, testFiles, readSource) {
  if (!testFiles.includes(sabotage.testFile)) return `${sabotage.testFile} is not one of the changed test files.`;
  if (!isSourceFile(sabotage.file)) return `${sabotage.file} is not an application source file.`;
  if (!sabotage.find || sabotage.find === sabotage.replace) return 'find must be non-empty and different from replace.';
  const source = readSource(sabotage.file);
  if (source === null) return `${sabotage.file} does not exist.`;
  const occurrences = source.split(sabotage.find).length - 1;
  if (occurrences !== 1) return `find must match exactly once in ${sabotage.file} (found ${occurrences}).`;
  return null;
}

function withReplacedFiles(workspace, replacements, action) {
  const originals = replacements.map(({ file }) => [file, readFileSync(path.join(workspace, file), 'utf8')]);
  try {
    for (const { file, content } of replacements) writeFileSync(path.join(workspace, file), content);
    return action();
  } finally {
    for (const [file, content] of originals) writeFileSync(path.join(workspace, file), content);
  }
}

function runGroups(workspace, groups) {
  const runs = Object.entries(groups).map(([project, files]) => runTests(workspace, project, files));
  return { crashed: runs.some((result) => result.crashed), results: runs.flatMap((result) => result.tests) };
}

function readSabotages(workspace) {
  const file = path.join(workspace, '.skeptic/claims.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).sabotages ?? [] : [];
}

export function prove({ workspace, base }) {
  const changes = collectChanges(workspace).filter((change) => change.status !== 'deleted' && isTestFile(change.path));
  const testFiles = changes.map((change) => change.path);
  const groups = groupByProject(testFiles);
  const proof = { base: base ?? null, testFiles, typecheck: {}, problems: [], experiments: [], tests: [] };
  if (!testFiles.length) return proof;

  for (const project of Object.keys(groups)) proof.typecheck[project] = typecheck(workspace, project);
  const head = runGroups(workspace, groups);
  if (head.crashed) proof.problems.push('The test run on the new code crashed, so nothing can be proven.');

  const experiments = [];
  if (base) {
    const mergeBase = git(workspace, 'merge-base', base, 'HEAD').trim();
    const files = git(workspace, 'diff', '--name-only', '--diff-filter=M', mergeBase, 'HEAD')
      .split('\n').filter(isSourceFile);
    if (files.length) {
      const replacements = files.map((file) => ({ file, content: git(workspace, 'show', `${mergeBase}:${file}`) }));
      experiments.push({ kind: 'time-travel', label: 'time travel', files, ...withReplacedFiles(workspace, replacements, () => runGroups(workspace, groups)) });
    }
  }

  const readSource = (file) => existsSync(path.join(workspace, file)) ? readFileSync(path.join(workspace, file), 'utf8') : null;
  readSabotages(workspace).forEach((sabotage, index) => {
    const label = `sabotage #${index + 1}`;
    const invalid = validateSabotage(sabotage, testFiles, readSource);
    if (invalid) {
      experiments.push({ kind: 'sabotage', label, ...sabotage, invalid, crashed: false, results: [] });
      return;
    }
    const content = readSource(sabotage.file).replace(sabotage.find, () => sabotage.replace);
    const outcome = withReplacedFiles(workspace, [{ file: sabotage.file, content }],
      () => runGroups(workspace, groupByProject([sabotage.testFile])));
    experiments.push({ kind: 'sabotage', label, ...sabotage, invalid: null, ...outcome });
  });

  for (const experiment of experiments) {
    if (experiment.crashed) proof.problems.push(`${experiment.label}: the test run crashed; it does not count as evidence.`);
  }
  const usable = experiments.filter((experiment) => !experiment.crashed);
  const originalTitles = Object.fromEntries(changes.map((change) => [change.path, testTitles(change.before ?? '')]));

  proof.tests = head.results.map((test) => ({
    file: test.file,
    name: test.name,
    isNew: ![...(originalTitles[test.file] ?? [])].some((template) => matchesTitle(template, test.title)),
    message: test.message,
    ...verdictFor(test, usable),
  }));
  const passedOnHead = new Set(head.results.filter((test) => test.status === 'passed').map((test) => `${test.file}\n${test.name}`));
  proof.experiments = experiments.map(({ results, ...experiment }) => ({
    ...experiment,
    caught: (results ?? [])
      .filter((result) => result.status === 'failed' && !result.loadError && passedOnHead.has(`${result.file}\n${result.name}`))
      .map((result) => result.name),
  }));
  return proof;
}

const ICON = { guards: '🛡️  guards   ', documents: '📘 documents', broken: '❌ broken   ' };

export function summarize(proof) {
  const lines = [];
  for (const [project, result] of Object.entries(proof.typecheck)) {
    lines.push(`${result.ok ? '✓' : '✗'} typecheck ${project}${result.ok ? '' : `\n${result.output}`}`);
  }
  for (const experiment of proof.experiments) {
    const what = experiment.kind === 'time-travel' ? `reverted ${experiment.files.join(', ')} to the base version` : `${experiment.file}: ${JSON.stringify(experiment.find)} → ${JSON.stringify(experiment.replace)}`;
    const outcome = experiment.invalid ? `invalid: ${experiment.invalid}` : experiment.crashed ? 'crashed' : `caught by ${experiment.caught.length} test(s)`;
    lines.push(`• ${experiment.label}: ${what} — ${outcome}`);
  }
  for (const test of proof.tests) {
    const evidence = test.evidence.length ? ` (${test.evidence.join(', ')})` : '';
    lines.push(`${ICON[test.verdict]} ${test.isNew ? '[new] ' : ''}${test.file} › ${test.name}${evidence}`);
    if (test.verdict === 'broken' && test.message) lines.push(`    ${test.message.split('\n').join('\n    ')}`);
  }
  for (const problem of proof.problems) lines.push(`! ${problem}`);
  return lines.join('\n') || 'No changed test files to prove.';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf('--base');
  const base = baseIndex >= 0 ? args.splice(baseIndex, 2)[1] : undefined;
  const workspace = path.resolve(args[0] ?? '.');
  const proof = prove({ workspace, base });
  mkdirSync(path.join(workspace, '.skeptic'), { recursive: true });
  writeFileSync(path.join(workspace, '.skeptic/proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  console.log(summarize(proof));
  const failed = proof.problems.length || proof.tests.some((test) => test.verdict === 'broken')
    || Object.values(proof.typecheck).some((result) => !result.ok);
  process.exitCode = failed ? 1 : 0;
}
