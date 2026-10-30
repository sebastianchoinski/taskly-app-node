import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkChanges, testTitles } from './guard.mjs';
import { matchesTitle, validateSabotage, verdictFor } from './prove.mjs';
import { groupByProject, isSourceFile, isTestFile, parseVitestReport } from './tests.mjs';

describe('file classification', () => {
  it('recognises test and source files of both projects', () => {
    assert.ok(isTestFile('backend/tests/router.test.ts'));
    assert.ok(isTestFile('frontend/src/lib/http.test.ts'));
    assert.ok(!isTestFile('backend/src/factory.ts'));
    assert.ok(isSourceFile('frontend/src/lib/http.ts'));
    assert.ok(!isSourceFile('frontend/src/lib/http.test.ts'));
    assert.ok(!isSourceFile('frontend/src/test/setup.ts'));
    assert.deepEqual(groupByProject(['backend/tests/a.test.ts', 'frontend/src/b.test.tsx', 'README.md']), {
      backend: ['backend/tests/a.test.ts'], frontend: ['frontend/src/b.test.tsx'],
    });
  });
});

describe('guard', () => {
  const added = (path, after) => ({ path, status: 'added', after });

  it('accepts new test files', () => {
    assert.deepEqual(checkChanges([added('backend/tests/config.test.ts', "it('works', () => {})")]), []);
  });

  it('rejects source changes, deletions, focus and skip', () => {
    const problems = checkChanges([
      added('backend/src/factory.ts', ''),
      { path: 'backend/tests/router.test.ts', status: 'deleted' },
      added('frontend/src/a.test.ts', "it.only('x', () => {})"),
      added('frontend/src/b.test.ts', "xit('x', () => {})"),
    ]);
    assert.equal(problems.length, 4);
  });

  it('notices a removed existing test but allows new ones next to it', () => {
    const before = "it('lists tasks', () => {})\nit.each([1, 2])('rejects %j', () => {})";
    assert.deepEqual(checkChanges([{ path: 'backend/tests/router.test.ts', status: 'modified', before, after: `${before}\nit('new', () => {})` }]), []);
    const problems = checkChanges([{ path: 'backend/tests/router.test.ts', status: 'modified', before, after: "it('lists tasks', () => {})" }]);
    assert.match(problems[0], /rejects %j/);
  });

  it('reads titles written with any quote style', () => {
    assert.deepEqual([...testTitles("it('a', f); test(\"b\", f); it(`c`, f); it.each([{ x: 1 }])('d %j', f)")], ['a', 'b', 'c', 'd %j']);
  });
});

describe('verdicts', () => {
  const test = { file: 'f.test.ts', name: 'returns 204', status: 'passed' };
  const experiment = (label, status, loadError = false) => ({ label, results: [{ ...test, status, loadError }] });

  it('a test that fails in an experiment guards the change', () => {
    assert.deepEqual(verdictFor(test, [experiment('time travel', 'failed')]), { verdict: 'guards', evidence: ['time travel'] });
  });

  it('a test that survives everything only documents behaviour', () => {
    assert.equal(verdictFor(test, [experiment('time travel', 'passed')]).verdict, 'documents');
  });

  it('a load error is not evidence', () => {
    assert.equal(verdictFor(test, [experiment('time travel', 'failed', true)]).verdict, 'documents');
  });

  it('a test failing on the new code is broken regardless of experiments', () => {
    assert.equal(verdictFor({ ...test, status: 'failed' }, [experiment('x', 'failed')]).verdict, 'broken');
  });
});

describe('recognising existing tests', () => {
  it('matches it.each titles against their templates', () => {
    assert.ok(matchesTitle('rejects invalid input: %j', 'rejects invalid input: {"title":"  "}'));
    assert.ok(matchesTitle('adds $a and $b.c', 'adds 1 and 2'));
    assert.ok(matchesTitle('lists tasks (newest first)', 'lists tasks (newest first)'));
    assert.ok(!matchesTitle('lists tasks', 'lists tasks again'));
  });
});

describe('sabotage validation', () => {
  const read = (file) => (file === 'frontend/src/lib/http.ts' ? 'a === 204 ? b : c; d === 1' : null);
  const sabotage = { testFile: 'frontend/src/lib/http.test.ts', file: 'frontend/src/lib/http.ts', find: '=== 204', replace: '=== 200' };
  const tests = ['frontend/src/lib/http.test.ts'];

  it('accepts a unique edit of a source file', () => {
    assert.equal(validateSabotage(sabotage, tests, read), null);
  });

  it('rejects ambiguous, missing, no-op and test-file edits', () => {
    assert.match(validateSabotage({ ...sabotage, find: '===' }, tests, read), /exactly once/);
    assert.match(validateSabotage({ ...sabotage, find: 'nope' }, tests, read), /exactly once/);
    assert.match(validateSabotage({ ...sabotage, replace: '=== 204' }, tests, read), /different/);
    assert.match(validateSabotage({ ...sabotage, file: sabotage.testFile }, tests, read), /not an application source/);
    assert.match(validateSabotage({ ...sabotage, testFile: 'frontend/src/x.test.ts' }, tests, read), /not one of the changed/);
  });
});

describe('vitest report parsing', () => {
  it('maps container paths and marks files that failed to load', () => {
    const tests = parseVitestReport({
      testResults: [
        { name: '/work/backend/tests/a.test.ts', assertionResults: [{ fullName: 'a works', title: 'works', status: 'passed', failureMessages: [] }] },
        { name: '/work/backend/tests/b.test.ts', message: 'Cannot find module', assertionResults: [] },
      ],
    }, '/work');
    assert.deepEqual(tests.map(({ file, name, status, loadError }) => [file, name, status, loadError]), [
      ['backend/tests/a.test.ts', 'a works', 'passed', false],
      ['backend/tests/b.test.ts', '(file failed to load)', 'failed', true],
    ]);
  });
});
