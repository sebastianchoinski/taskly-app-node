export const MARKER = '<!-- skeptic-report -->';

const VERDICT = { guards: '🛡️ guards the change', documents: '📘 only documents', broken: '❌ broken' };
const DECISION = {
  'skip': 'Skip — no tests needed',
  'check-only': 'Check only — behaviour should not change',
  'write-tests': 'Write tests for new behaviour',
  'regression-test': 'Regression test for a bug fix',
};
const code = (text) => `\`${String(text).replaceAll('`', 'ˋ')}\``;
// Text written by the agent must not ping people or inject HTML into the PR page.
export const plain = (text) => String(text ?? '').replace(/@(?=[\w-])/g, '@\u200b').replaceAll('<', '&lt;');
const cell = (text) => plain(text).replaceAll('|', '\\|').replaceAll('\n', ' ');

function headline(report) {
  const tests = report.proof?.tests.filter((test) => test.isNew) ?? [];
  const count = (verdict) => tests.filter((test) => test.verdict === verdict).length;
  switch (report.status) {
    case 'skipped':
    case 'no-tests-needed':
      return `**No tests proposed.** ${cell(report.reason)}`;
    case 'proposed':
      return `**${tests.length} new test(s) proposed** — ${count('guards')} 🛡️ guard the change, ${count('documents')} 📘 only document behaviour. `
        + (report.testsPr ? `Review and merge them in ${report.testsPr}.` : 'They are attached to this run as `tests.patch`.');
    case 'rejected':
      return report.proof
        ? '**Nothing proposed.** The generated tests did not pass verification, so they are not worth your review time. Details below.'
        : '**Nothing proposed.** The agent broke a rule (see Problems), so its changes were discarded without running them.';
    default:
      return `**The agent run failed** before producing a result: ${report.problems.join(' ') || 'unknown error'}`;
  }
}

function promisesTable(report) {
  const tests = report.proof?.tests.filter((test) => test.isNew) ?? [];
  if (!tests.length) return [];
  const claimed = new Set();
  const rows = (report.promises ?? []).flatMap(({ promise, tests: titles }) => {
    const matched = tests.filter((test) => titles?.some((title) => test.name.endsWith(title)));
    matched.forEach((test) => claimed.add(test));
    return matched.length
      ? matched.map((test, index) => [index ? '〃' : promise, test])
      : [[promise, null]];
  });
  for (const test of tests) if (!claimed.has(test)) rows.push(['(no promise given)', test]);
  return [
    '| Promise | Test | Verdict | Evidence |',
    '| --- | --- | --- | --- |',
    ...rows.map(([promise, test]) => test
      ? `| ${cell(promise)} | ${code(test.file.split('/').pop())} › ${cell(test.name)} | ${VERDICT[test.verdict]} | ${cell(test.evidence.join(', ') || '—')} |`
      : `| ${cell(promise)} | — | ⚠️ no test | — |`),
    '',
  ];
}

function experiments(report) {
  const proof = report.proof;
  if (!proof) return [];
  const lines = Object.entries(proof.typecheck).map(([project, result]) => `- Typecheck ${project}: ${result.ok ? '✅' : '❌'}`);
  for (const experiment of proof.experiments) {
    const what = experiment.kind === 'time-travel'
      ? `reverted ${experiment.files.map(code).join(', ')} to the base branch`
      : `${code(experiment.file)}: ${code(experiment.find)} → ${code(experiment.replace)}${experiment.why ? ` — ${cell(experiment.why)}` : ''}`;
    const outcome = experiment.invalid ? `ignored (${experiment.invalid})` : experiment.crashed ? 'crashed, not counted' : `caught by ${experiment.caught.length} test(s)`;
    lines.push(`- **${experiment.label}**: ${what} → ${outcome}`);
  }
  for (const test of proof.tests.filter((test) => test.verdict === 'broken')) {
    lines.push(`- ❌ ${code(test.file)} › ${cell(test.name)}\n  \`\`\`text\n  ${test.message.split('\n').join('\n  ')}\n  \`\`\``);
  }
  return ['<details><summary>How the tests were checked</summary>', '', ...lines, '', '</details>', ''];
}

export function renderComment(report) {
  const list = (title, items) => items?.length ? [`**${title}**`, ...items.map((item) => `- ${cell(item)}`), ''] : [];
  return [
    MARKER,
    `### 🧪 Skeptic — unit tests for ${report.mode === 'coverage' ? 'existing code' : 'this change'}`,
    '',
    report.decision ? `**Decision:** ${report.mode === 'coverage' && report.decision === 'write-tests' ? 'Write tests for the riskiest untested code' : DECISION[report.decision] ?? report.decision}. ${report.status === 'skipped' ? '' : cell(report.reason)}` : '',
    '',
    headline(report),
    '',
    ...promisesTable(report),
    ...list('Problems', report.status === 'failed' ? [] : report.problems),
    ...list('Deliberately not tested', report.skipped?.map(({ target, why }) => `${code(target)} — ${why}`)),
    ...list('Concerns about the code', report.concerns),
    ...experiments(report),
    `<sub>Mode: ${report.mode} · base ${code(report.base?.slice(0, 7) ?? '—')} · head ${code(report.head.slice(0, 7))} · runtime: ${report.runtime} · skills used: ${report.skillsUsed?.join(', ') || 'none'}</sub>`,
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}
