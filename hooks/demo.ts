import type { TaskRow } from '../types'

const DEMO_PREFIX = 'demo-'

const SAMPLES: readonly Omit<TaskRow, 'id'>[] = [
  { name: 'Migrazione schema database', status: 'completed', blockedBy: [], progress: null },
  { name: 'Refactor client API', status: 'in_progress', blockedBy: [], progress: 82 },
  { name: 'Test componenti UI', status: 'in_progress', blockedBy: [], progress: 47 },
  { name: 'Audit permessi di accesso', status: 'in_progress', blockedBy: [], progress: 15 },
  { name: 'Aggiornare documentazione', status: 'pending', blockedBy: [], progress: null },
  { name: 'Deploy su staging', status: 'pending', blockedBy: [`${DEMO_PREFIX}1`], progress: null },
  { name: 'Build di release', status: 'stopped', blockedBy: [], progress: 63 },
]

export const hasDemo = (list: TaskRow[]): boolean => list.some(row => row.id.startsWith(DEMO_PREFIX))

export const withoutDemo = (list: TaskRow[]): TaskRow[] =>
  list.filter(row => !row.id.startsWith(DEMO_PREFIX))

/** The sample rows, one per state the band can draw, after the real ones. */
export const withDemo = (list: TaskRow[]): TaskRow[] => [
  ...withoutDemo(list),
  ...SAMPLES.map((sample, index) => ({ ...sample, id: `${DEMO_PREFIX}${index}` })),
]
