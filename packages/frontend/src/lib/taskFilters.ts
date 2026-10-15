import type { CardPriority, CardType, KanbanCard, KanbanColumn, TaskInfo } from './api'

export type TaskPriorityFilter = 'all' | CardPriority | 'none'
export type TaskStateFilter = 'active' | 'archived' | 'all'
export type TaskTypeFilter = 'all' | CardType

export interface TaskFilterValues {
  priorityFilter: TaskPriorityFilter
  typeFilter: TaskTypeFilter
  assigneeFilter: string
  labelFilter: string
  stateFilter: TaskStateFilter
  searchPattern: string
}

export const defaultTaskFilters: TaskFilterValues = {
  priorityFilter: 'all',
  typeFilter: 'all',
  assigneeFilter: 'all',
  labelFilter: 'all',
  stateFilter: 'active',
  searchPattern: '',
}

const MAX_SEARCH_PATTERN_LENGTH = 200

export function compileSearchRegex(pattern: string) {
  const clean = pattern.trim()
  if (!clean) return { regex: undefined, error: '' }
  if (clean.length > MAX_SEARCH_PATTERN_LENGTH) return { regex: undefined, error: `Pattern too long (max ${MAX_SEARCH_PATTERN_LENGTH} chars)` }

  try {
    return { regex: new RegExp(clean, 'i'), error: '' }
  } catch (error) {
    return { regex: undefined, error: error instanceof Error ? error.message : 'Invalid regex' }
  }
}

export function hasFilterValues(filters: TaskFilterValues) {
  return filters.priorityFilter !== 'all' || filters.typeFilter !== 'all' || filters.assigneeFilter !== 'all' || filters.labelFilter !== 'all' || filters.stateFilter !== 'active' || filters.searchPattern.trim() !== ''
}

export function hasAppliedFilters(filters: TaskFilterValues, regex?: RegExp) {
  return filters.priorityFilter !== 'all' || filters.typeFilter !== 'all' || filters.assigneeFilter !== 'all' || filters.labelFilter !== 'all' || filters.stateFilter !== 'active' || Boolean(regex)
}

function matchesPriority(priority: CardPriority | undefined, filter: TaskPriorityFilter) {
  if (filter === 'all') return true
  if (filter === 'none') return !priority
  return priority === filter
}

function matchesType(type: CardType | undefined, filter: TaskTypeFilter) {
  return filter === 'all' || (type ?? 'task') === filter
}

function matchesAssignee(assignees: string[] | undefined, filter: string) {
  return filter === 'all' || Boolean(assignees?.includes(filter))
}

function matchesLabel(labels: string[] | undefined, filter: string) {
  if (filter === 'all') return true
  if (filter === 'none') return !labels?.length
  return Boolean(labels?.includes(filter))
}

function matchesState(archived: boolean | undefined, filter: TaskStateFilter) {
  if (filter === 'all') return true
  return filter === 'archived' ? archived === true : archived !== true
}

function matchesRegex(regex: RegExp | undefined, values: Array<string | undefined>) {
  if (!regex) return true
  return regex.test(values.filter(Boolean).join('\n'))
}

export function matchesTaskInfoFilters(task: TaskInfo, filters: TaskFilterValues, regex?: RegExp, includeAssignees = true) {
  const commentValues = (task.comments ?? []).flatMap((comment) => [comment.author, comment.body, comment.editedBy])
  const assigneeValues = includeAssignees ? task.assignees : []
  return (
    matchesPriority(task.priority, filters.priorityFilter) &&
    matchesType(task.type, filters.typeFilter) &&
    matchesAssignee(includeAssignees ? task.assignees : undefined, includeAssignees ? filters.assigneeFilter : 'all') &&
    matchesLabel(task.labels, filters.labelFilter) &&
    matchesState(task.archived, filters.stateFilter) &&
    matchesRegex(regex, [task.id, task.uid, task.title, task.description, task.columnId, task.columnTitle, task.columnStatus, task.columnIcon, task.priority, task.type, ...assigneeValues, ...(task.labels ?? []), ...commentValues])
  )
}

export function matchesKanbanCardFilters(card: KanbanCard, column: Pick<KanbanColumn, 'id' | 'title' | 'status'>, filters: TaskFilterValues, regex?: RegExp, includeAssignees = true) {
  const commentValues = (card.comments ?? []).flatMap((comment) => [comment.author, comment.body, comment.editedBy])
  const assigneeValues = includeAssignees ? card.assignees ?? [] : []
  return (
    matchesPriority(card.priority, filters.priorityFilter) &&
    matchesType(card.type, filters.typeFilter) &&
    matchesAssignee(includeAssignees ? card.assignees : undefined, includeAssignees ? filters.assigneeFilter : 'all') &&
    matchesLabel(card.labels, filters.labelFilter) &&
    matchesState(card.archived, filters.stateFilter) &&
    matchesRegex(regex, [card.id, card.uid, card.title, card.description, column.id, column.title, column.status, card.priority, card.type, ...assigneeValues, ...(card.labels ?? []), ...commentValues])
  )
}

export function matchesBoardSearch(regex: RegExp | undefined, title: string, path: string) {
  return matchesRegex(regex, [title, path])
}
