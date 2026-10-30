import request from 'supertest';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/factory.ts';
import type { Database } from '../src/features/todos/types.ts';

function setup() {
  const todo = { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) };
  return { todo, app: createApp({ todo } as unknown as Database) };
}

afterEach(() => vi.restoreAllMocks());

it('reports health after querying the database', async () => {
  const { app, todo } = setup();
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(todo.findFirst).toHaveBeenCalledOnce();
});
it('answers unknown routes with a JSON 404', async () => {
  const response = await request(setup().app).get('/api/nothing-here');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Not Found' });
});
it('rejects malformed JSON with 422 instead of crashing', async () => {
  const response = await request(setup().app).post('/api/todos').set('Content-Type', 'application/json').send('{"title":');
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
});
it('rejects request bodies over the size limit with 413', async () => {
  const response = await request(setup().app).post('/api/todos').send({ title: 'x', description: 'y'.repeat(200_000) });
  expect(response.status).toBe(413);
  expect(response.body).toEqual({ detail: 'Request body too large.' });
});
it('hides internal errors behind a generic 500', async () => {
  const { app, todo } = setup();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  todo.findMany.mockRejectedValue(new Error('password authentication failed for user "taskly"'));
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(log).toHaveBeenCalled();
});
it('does not advertise Express in response headers', async () => {
  const response = await request(setup().app).get('/api/health');
  expect(response.headers['x-powered-by']).toBeUndefined();
});
