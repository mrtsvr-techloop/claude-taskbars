export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'stopped'

export type TaskRow = {
  id: string
  name: string
  status: TaskStatus
  /** Ids of the tasks this one waits for. */
  blockedBy: string[]
  /** 0-100 as the model reported it in `metadata.progress`; null when it never did. */
  progress: number | null
}

/** One task as the model declares it through the mod's own tool. */
export type DeclaredTask = {
  name: string
  status: 'pending' | 'in_progress' | 'completed' | 'blocked'
  progress?: number
}

declare module 'claude-code' {
  interface McpToolInputs {
    'mcp__task-bars__set_tasks': { tasks: DeclaredTask[] }
  }

  interface PluginState {
    'task-bars': { tasks: TaskRow[]; isHidden: boolean }
  }
}
