import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { TodosHeader } from './TodosHeader'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('does not show overdue text when overdue count is 0', () => {
  render(<TodosHeader disabled={false} overdue={0} onCreate={() => {}} />)
  expect(screen.queryByText(/task.*overdue/i)).not.toBeInTheDocument()
})

it('shows singular overdue text when overdue count is 1', () => {
  render(<TodosHeader disabled={false} overdue={1} onCreate={() => {}} />)
  expect(screen.getByText('1 task is overdue.')).toBeVisible()
})

it('shows plural overdue text when overdue count is greater than 1', () => {
  render(<TodosHeader disabled={false} overdue={3} onCreate={() => {}} />)
  expect(screen.getByText('3 tasks are overdue.')).toBeVisible()
})
