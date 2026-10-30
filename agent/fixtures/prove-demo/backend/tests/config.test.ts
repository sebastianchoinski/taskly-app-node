import { afterEach, expect, it, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

afterEach(() => vi.unstubAllEnvs());

it('accepts the short postgres:// scheme', () => {
  expect(resolveDatabaseUrl('postgres://user:secret@db:5432/taskly')).toBe('postgresql://user:secret@db:5432/taskly');
});

it('builds the URL from separate variables and encodes special characters', () => {
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('POSTGRES_USER', 'taskly');
  vi.stubEnv('POSTGRES_PASSWORD', 'p@ss/word');
  vi.stubEnv('POSTGRES_HOST', 'db');
  vi.stubEnv('DB_PORT', '5432');
  vi.stubEnv('POSTGRES_DB', 'taskly');
  expect(resolveDatabaseUrl()).toBe('postgresql://taskly:p%40ss%2Fword@db:5432/taskly');
});
