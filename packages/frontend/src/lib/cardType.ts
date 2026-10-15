import type { CardType } from './api'

export const cardTypeOptions: Array<{ value: CardType; label: string }> = [
  { value: 'task', label: 'Task' },
  { value: 'bug', label: 'Bug' },
]

export function cardTypeLabel(type?: CardType) {
  return (type ?? 'task') === 'bug' ? 'Bug' : 'Task'
}
