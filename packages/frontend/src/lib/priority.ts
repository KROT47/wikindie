import type { CardPriority } from './api'

// 8px priority dot. `mt-1.5` centres it on a 20px (`text-sm`) line box, so it lines
// up with card titles and the bug/task icon when placed in the same flex row.
export const priorityDotClass = 'mt-1.5 size-2 shrink-0 rounded-full'

export function priorityColor(priority?: CardPriority) {
  if (priority === 'high') return 'bg-danger'
  if (priority === 'medium') return 'bg-warning'
  if (priority === 'low') return 'bg-info'
  return 'bg-border'
}

export function priorityLabel(priority?: CardPriority) {
  return priority ? `${priority[0].toUpperCase()}${priority.slice(1)} priority` : 'No priority'
}

export function priorityRank(priority?: CardPriority) {
  if (priority === 'high') return 0
  if (priority === 'medium') return 1
  if (priority === 'low') return 2
  return 3
}
