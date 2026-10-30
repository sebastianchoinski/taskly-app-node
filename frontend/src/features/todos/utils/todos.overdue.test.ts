import { describe, expect, it } from 'vitest'
import { selectTodos } from './todos'
import type { Todo } from '../types'

const base: Todo = {
  id: 1,
  title: 'Task',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

describe('selectTodos overdue filter', () => {
  it('filters only overdue tasks when filter is overdue', () => {
    const overdueTodo = {
      ...base,
      id: 1,
      completed: false,
      due_date: '2020-01-01',
    }
    const activeFuture = {
      ...base,
      id: 2,
      completed: false,
      due_date: '2030-01-01',
    }
    const completedPast = {
      ...base,
      id: 3,
      completed: true,
      due_date: '2020-01-01',
    }
    const todos = [overdueTodo, activeFuture, completedPast]
    expect(selectTodos(todos, 'overdue', '', 'newest')).toEqual([overdueTodo])
  })
})
