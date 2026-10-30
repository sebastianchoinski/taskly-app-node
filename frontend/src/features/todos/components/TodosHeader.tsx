import { Plus } from 'lucide-react'
import { Button, Heading, Text } from '../../../design-system'

export function TodosHeader({
  disabled,
  overdue = 0,
  onCreate,
}: {
  disabled: boolean
  overdue?: number
  onCreate: () => void
}) {
  return (
    <section className="row spread" aria-labelledby="page-title">
      <div className="stack compact">
        <Heading id="page-title">Tasks</Heading>
        <Text muted>Create, organize, and complete tasks.</Text>
        {overdue > 0 && (
          <Text>
            {overdue === 1
              ? '1 task is overdue.'
              : `${overdue} tasks are overdue.`}
          </Text>
        )}
      </div>
      <Button disabled={disabled} onClick={onCreate}>
        <Plus size={18} aria-hidden="true" />
        New task
      </Button>
    </section>
  )
}
