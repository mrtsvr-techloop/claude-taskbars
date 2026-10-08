import type { TaskRow, TaskStatus } from '../types'

type Bag = Record<string, unknown>

export type Tone = 'success' | 'warning' | 'error'

const TODO_PREFIX = 'todo-'
/** A started task whose progress the model never reported sits at the middle. */
const UNREPORTED_PERCENT = 50

const isBag = (value: unknown): value is Bag =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const asIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []

const asStatus = (value: unknown): TaskStatus | undefined =>
  value === 'pending' || value === 'in_progress' || value === 'completed' ? value : undefined

const asProgress = (metadata: unknown): number | undefined => {
  const value = isBag(metadata) ? metadata.progress : undefined

  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : undefined
}

/** TaskCreate's result adds one awaiting row. */
export const created = (list: TaskRow[], result: unknown): TaskRow[] => {
  const task = isBag(result) ? result.task : undefined
  const id = isBag(task) ? asText(task.id) : undefined

  if (!isBag(task) || id === undefined || list.some(row => row.id === id)) {
    return list
  }

  return [
    ...list,
    { id, name: asText(task.subject) ?? id, status: 'pending', blockedBy: [], progress: null },
  ]
}

/** TaskUpdate's input, once its result says it took, changes or removes one row. */
export const updated = (list: TaskRow[], input: Bag, result: unknown): TaskRow[] => {
  const id = asText(input.taskId)

  if (id === undefined || !isBag(result) || result.success !== true) {
    return list
  }

  if (input.status === 'deleted') {
    return list.filter(row => row.id !== id)
  }

  const known = list.find(row => row.id === id)
  const row: TaskRow = known ?? { id, name: id, status: 'pending', blockedBy: [], progress: null }
  const next: TaskRow = {
    ...row,
    name: asText(input.subject) ?? row.name,
    status: asStatus(input.status) ?? row.status,
    blockedBy: [...new Set([...row.blockedBy, ...asIds(input.addBlockedBy)])],
    progress: asProgress(input.metadata) ?? row.progress,
  }

  return known ? list.map(one => (one.id === id ? next : one)) : [...list, next]
}

/** TaskList's result is the whole task list: it replaces every row but the todos. */
export const listed = (list: TaskRow[], result: unknown): TaskRow[] => {
  const tasks = isBag(result) && Array.isArray(result.tasks) ? result.tasks : undefined

  if (tasks === undefined) {
    return list
  }

  const rows = tasks.flatMap((task): TaskRow[] => {
    const id = isBag(task) ? asText(task.id) : undefined

    if (!isBag(task) || id === undefined) {
      return []
    }

    const known = list.find(row => row.id === id)
    const status = asStatus(task.status) ?? 'pending'

    return [
      {
        id,
        name: asText(task.subject) ?? id,
        // TaskList does not know a turn was interrupted: a stopped row stays stopped.
        status: known?.status === 'stopped' && status === 'in_progress' ? 'stopped' : status,
        blockedBy: asIds(task.blockedBy),
        progress: known?.progress ?? null,
      },
    ]
  })

  return [...rows, ...list.filter(row => row.id.startsWith(TODO_PREFIX))]
}

/** TodoWrite's input is the whole todo list: it replaces every todo row. */
export const todos = (list: TaskRow[], input: Bag): TaskRow[] => {
  if (!Array.isArray(input.todos)) {
    return list
  }

  const rows = input.todos.flatMap((todo, index): TaskRow[] => {
    const name = isBag(todo) ? asText(todo.content) : undefined

    return isBag(todo) && name !== undefined
      ? [
          {
            id: `${TODO_PREFIX}${index}`,
            name,
            status: asStatus(todo.status) ?? 'pending',
            blockedBy: [],
            progress: null,
          },
        ]
      : []
  })

  return [...list.filter(row => !row.id.startsWith(TODO_PREFIX)), ...rows]
}

/** An interrupted turn leaves what was running stopped. */
export const interrupted = (list: TaskRow[]): TaskRow[] =>
  list.map(row => (row.status === 'in_progress' ? { ...row, status: 'stopped' } : row))

export const isAllDone = (list: TaskRow[]): boolean =>
  list.length > 0 && list.every(row => row.status === 'completed')

export const isBlocked = (row: TaskRow, list: TaskRow[]): boolean =>
  row.status !== 'completed' &&
  row.blockedBy.some(id => list.some(one => one.id === id && one.status !== 'completed'))

export const percentOf = (row: TaskRow): number => {
  if (row.status === 'completed') {
    return 100
  }

  if (row.status === 'pending') {
    return row.progress ?? 0
  }

  return row.progress ?? UNREPORTED_PERCENT
}

export const labelOf = (row: TaskRow, list: TaskRow[]): string => {
  if (row.status === 'completed') {
    return 'fine'
  }

  if (row.status === 'stopped') {
    return 'stopped'
  }

  if (isBlocked(row, list)) {
    return 'blocked'
  }

  return row.status === 'pending' ? 'awaiting' : 'in corso'
}

/** Green while it runs and when done, orange while it waits, red blocked or stopped. */
export const toneOf = (row: TaskRow, list: TaskRow[]): Tone => {
  if (row.status === 'stopped' || isBlocked(row, list)) {
    return 'error'
  }

  return row.status === 'pending' ? 'warning' : 'success'
}

/** Below this width a cell drops the state's label and keeps the percentage. */
const LABEL_MIN_COLUMNS = 34

/**
 * One task as a bar `width` cells wide with its text inside: the name at the
 * left, the state and the percentage at the right, cut where the fill ends.
 */
export const cellOf = (row: TaskRow, list: TaskRow[], width: number): { filled: string; rest: string } => {
  const percent = percentOf(row)
  const tail = width >= LABEL_MIN_COLUMNS ? `${labelOf(row, list)} ${percent}%` : `${percent}%`
  const room = Math.max(0, width - tail.length - 3)
  const name = row.name.length > room ? `${row.name.slice(0, Math.max(0, room - 1))}…` : row.name
  const text = ` ${name.padEnd(room)} ${tail} `.slice(0, width).padEnd(width)
  const cells = Math.min(width, Math.max(0, Math.round((percent / 100) * width)))

  return { filled: text.slice(0, cells), rest: text.slice(cells) }
}

/** The rows that fit: when there are too many, finished ones give way first. */
export const fitting = (list: TaskRow[], room: number): TaskRow[] => {
  if (list.length <= room) {
    return list
  }

  const open = list.filter(row => row.status !== 'completed')
  const kept = new Set(
    (open.length >= room ? open.slice(0, room) : [...open, ...list.filter(row => !open.includes(row))].slice(0, room)).map(
      row => row.id,
    ),
  )

  return list.filter(row => kept.has(row.id))
}
