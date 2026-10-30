import { test, expect } from 'vitest';
import { summarize } from '../src/features/todos/summary.ts';

test('summarize handles empty todos array', () => {
  const summary = summarize([], '2026-06-01');
  expect(summary).toEqual({ total: 0, active: 0, completed: 0, overdue: 0 });
});
