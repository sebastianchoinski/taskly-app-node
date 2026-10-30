import type { Todo } from './types.js';

export interface TodoSummary {
  total: number;
  active: number;
  completed: number;
  overdue: number;
}

// `today` is a YYYY-MM-DD date; a task due today is not overdue yet.
export function summarize(todos: Todo[], today: string): TodoSummary {
  const completed = todos.filter((todo) => todo.completed).length;
  const overdue = todos.filter((todo) => !todo.completed && todo.due_date !== null && todo.due_date < today).length;
  return { total: todos.length, active: todos.length - completed, completed, overdue };
}
