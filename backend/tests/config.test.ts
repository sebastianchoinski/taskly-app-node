import { afterEach, expect, it, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

const parts = { POSTGRES_USER: 'taskly', POSTGRES_PASSWORD: 'p@ss/word', POSTGRES_HOST: 'db', DB_PORT: '5432', POSTGRES_DB: 'taskly' };

function stubParts(overrides: Partial<Record<keyof typeof parts, string>> = {}) {
  vi.stubEnv('DATABASE_URL', '');
  for (const [name, value] of Object.entries({ ...parts, ...overrides })) vi.stubEnv(name, value);
}

afterEach(() => vi.unstubAllEnvs());

it('prefers an explicit URL over DATABASE_URL', () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://env@db/env');
  expect(resolveDatabaseUrl('postgresql://override@db/override')).toBe('postgresql://override@db/override');
});
it('normalises the SQLAlchemy psycopg scheme', () => {
  expect(resolveDatabaseUrl('postgresql+psycopg://user:secret@db:5432/taskly')).toBe('postgresql://user:secret@db:5432/taskly');
});
it('builds the URL from separate variables and escapes special characters', () => {
  stubParts();
  expect(resolveDatabaseUrl()).toBe('postgresql://taskly:p%40ss%2Fword@db:5432/taskly');
});
it('names the missing variable instead of building a broken URL', () => {
  stubParts({ DB_PORT: '' });
  expect(() => resolveDatabaseUrl()).toThrow('Missing environment variable: DB_PORT');
});
