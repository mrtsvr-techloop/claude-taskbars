export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'stopped'

export type TaskRow = {
  id: string
  name: string
  status: TaskStatus
  /** Ids of the tasks this one waits for. */
  blockedBy: string[]
  /** 0-100 as the model reported it in `metadata.progress`; null when it never did. */
  progress: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'task-bars': { tasks: TaskRow[]; isHidden: boolean }
  }
}
