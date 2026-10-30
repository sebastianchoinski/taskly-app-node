import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { summarize } from '../src/features/todos/summary.ts';
import { todo } from './fixture.ts';

it('summarizes tasks correctly with active, completed, and overdue counts', () => {
  const todos = [
    { ...todo, id: 1, completed: false, due_date: '2020-01-01' }, // overdue
    { ...todo, id: 2, completed: false, due_date: '2030-01-01' }, // active, not overdue
    { ...todo, id: 3, completed: true, due_date: '2020-01-01' },  // completed
    { ...todo, id: 4, completed: false, due_date: null },          // active, no due date
  ];
  const summary = summarize(todos, '2026-06-01');
  expect(summary).toEqual({
    total: 4,
    active: 3,
    completed: 1,
    overdue: 1,
  });
});

it('exposes summary endpoint on the router', async () => {
  const repository = {
    list: vi.fn().mockResolvedValue([
      { ...todo, id: 1, completed: false, due_date: '2020-01-01' }
    ]),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));

  const response = await request(app).get('/api/todos/summary');
  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('total', 1);
  expect(response.body).toHaveProperty('active', 1);
  expect(response.body).toHaveProperty('completed', 0);
  expect(response.body).toHaveProperty('overdue', 1);
  expect(repository.list).toHaveBeenCalledOnce();
});
