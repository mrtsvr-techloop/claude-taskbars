export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'stopped'

export type TaskRow = {
  id: string
  name: string
  status: TaskStatus
  /** Ids of the tasks this one waits for. */
  blockedBy: string[]
  /** Pinned by the person's click or by the model: no clean-up removes it. */
  isPinned?: boolean
  /** 0-100 as the model reported it in `metadata.progress`; null when it never did. */
  progress: number | null
}

/** One task as the model declares it through the mod's own tool. */
export type DeclaredTask = {
  name: string
  status: 'pending' | 'in_progress' | 'completed' | 'blocked'
  progress?: number
  /** Pins the task: it stays until the person unpins it. */
  persistent?: boolean
}

/** A signal of Mod Signals 0.1, as the mod writes it under `signal` for every other mod to hear. */
export type TaskBarsSignal = {
  v: 1
  kind: 'event' | 'command' | 'announce'
  name: string
  to?: string
  data?: Record<string, unknown>
  /** What kind of signal this is, for whoever picks signals by kind: `['info', 'completion']`. */
  tags?: string[]
  id: string
}

/** A task as another mod reads it. */
export type TaskBarsTask = { id: string; name: string; status: TaskStatus; progress: number | null }

/** One task's change of status: `from` null when it appears, `to` null when it leaves the list. */
export type TaskBarsChange = { id: string; name: string; from: TaskStatus | null; to: TaskStatus | null }

/**
 * What any other mod calls on `$.taskBars`, and the event it hooks to follow
 * the tasks: `on('taskBars.statusChanged', hook)`.
 */
export type TaskBars = {
  /** Shows the bars; answers whether they are shown once the call is done, as the next three do. */
  open: () => Promise<boolean>
  close: () => Promise<boolean>
  toggle: () => Promise<boolean>
  isOpen: () => Promise<boolean>
  list: () => Promise<TaskBarsTask[]>
  /** The status of the task of that id, else of that name; null when there is none. */
  getStatus: (ref: { task: string }) => Promise<TaskStatus | null>
  /** Called by the mod itself at every change of status: hook it, do not call it. */
  statusChanged: (change: TaskBarsChange) => Promise<void>
}

declare module 'claude-code' {
  interface EngineInterface {
    taskBars: TaskBars
  }

  interface McpToolInputs {
    'mcp__task-bars__set_tasks': { tasks: DeclaredTask[] }
  }

  interface PluginState {
    'task-bars': {
      tasks: TaskRow[]
      isHidden: boolean
      /** The mod's signals: `announce`, `opened`, `closed`, `status-changed`. */
      signal: TaskBarsSignal | null
    }
  }
}
