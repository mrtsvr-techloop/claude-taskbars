import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TaskRow } from '../types'

import { hasDemo, withDemo, withoutDemo } from './demo'
import {
  agentAnswered,
  agentCalled,
  agentStopped,
  cellOf,
  changesOf,
  cleared,
  created,
  declared,
  fitting,
  interrupted,
  listed,
  todos,
  toggled,
  toneOf,
  updated,
} from './model'
import { ROLL_CALL_MS, readSignal, signalOf } from './mod-signals/kit/signals'
import type { Announce, SignalKind } from './mod-signals/kit/signals'

const COMMAND = 'task-bars'
const DEMO_COMMAND = 'task-bars-demo'
const MAX_ROWS = 10
/** Two columns of bars from the width that gives each this much. */
const MIN_CELL_COLUMNS = 30
const MAX_CELL_COLUMNS = 60
const GAP_COLUMNS = 2
/** The pin at the head of each bar, the one spot of it a click reaches. */
const PIN_COLUMNS = 3
const PINNED = '📌'
const LOOSE = '○'

const PROGRESS_SECTION = {
  id: 'task-bars:progress',
  text:
    'The person watches one progress bar per task above the prompt. Keep the bars current without ' +
    'being asked and without announcing it: for any work of two or more steps, call ' +
    'mcp__task-bars__set_tasks with the whole list as you start, and again whenever a step starts, ' +
    'reaches a real milestone, ends or gets blocked, giving each in_progress task its progress ' +
    '(0-100). Where you keep a task list with TaskCreate and TaskUpdate, that list is shown already: ' +
    'report progress there with TaskUpdate metadata: { "progress": <0-100> } and leave set_tasks out.',
  scope: 'session',
} as const

const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'blocked']

const SET_TASKS = {
  name: 'set_tasks',
  description:
    'Shows the person the tasks of the current work as progress bars above the prompt. Takes the ' +
    'whole list every time: it replaces the one shown before; an empty list clears it. A task ' +
    'marked persistent is pinned: it stays, even left out of a later list, until the person unpins it.',
  inputSchema: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'A short title for the task' },
            status: { type: 'string', enum: TASK_STATUSES },
            progress: { type: 'number', minimum: 0, maximum: 100, description: 'How far an in_progress task is' },
            persistent: { type: 'boolean', description: 'Pins the task so no clean-up removes it' },
          },
          required: ['name', 'status'],
        },
      },
    },
    required: ['tasks'],
  },
}

const tasks = atom({ plugin: 'task-bars', key: 'tasks' } as const, [])
const isHidden = atom({ plugin: 'task-bars', key: 'isHidden' } as const, false)

/** The mod's name as the engine gives it: the `to` of the commands it obeys. */
const MOD = 'task-bars'
const SELF: Announce = { title: 'Tasks', accepts: ['open', 'close', 'toggle'], emits: ['opened', 'closed', 'status-changed'] }

const signal = atom({ plugin: 'task-bars', key: 'signal' } as const, null)
const sent = { count: 0, answeredAt: 0 }

/** One signal to whoever listens; a mod above that refuses the write stops nothing here. */
const emit = async (
  $: EngineInterface,
  kind: SignalKind,
  name: string,
  data?: Record<string, unknown>,
  tags?: string[],
): Promise<void> => {
  sent.count += 1

  try {
    await update($, signal, () => signalOf(kind, name, sent.count, Date.now(), { ...(data === undefined ? {} : { data }), ...(tags === undefined ? {} : { tags }) }))
  } catch {
    // The mod goes on without the signal.
  }
}

/**
 * Every write of the tasks: each change of status it makes is told to the mods
 * hooked on `taskBars.statusChanged`, one that fails stopping nothing, and to
 * whoever listens to signals, as the event `status-changed`.
 */
const change = async ($: EngineInterface, apply: (list: TaskRow[]) => TaskRow[]): Promise<void> => {
  const before = await read($, tasks)
  await update($, tasks, apply)

  for (const one of changesOf(before, await read($, tasks))) {
    try {
      await $.taskBars.statusChanged(one)
    } catch {
      // The tasks go on whatever a listener met.
    }

    // A task that is done is the one change tagged for whoever tells the person.
    await emit($, 'event', 'status-changed', { ...one, text: `${one.name} is done` }, one.to === 'completed' ? ['info', 'completion'] : undefined)
  }
}

/** Shows or hides the bars, and says so where that changed. */
const setHidden = async ($: EngineInterface, hidden: boolean): Promise<boolean> => {
  const wasHidden = await read($, isHidden)
  await update($, isHidden, () => hidden)

  if (wasHidden !== hidden) {
    await emit($, 'event', hidden ? 'closed' : 'opened')
  }

  return !hidden
}

/** A command another mod sent: what the person could do with `/task-bars`, and no more. */
const obey = async ($: EngineInterface, name: string): Promise<void> => {
  if (name === 'open') {
    await $.taskBars.open()
  } else if (name === 'close') {
    await $.taskBars.close()
  } else if (name === 'toggle') {
    await $.taskBars.toggle()
  }
}

export const register: Register = on => {
  // Mod Signals: every signal, whoever writes it. The write goes on first and
  // untouched; the mod answers a roll-call and obeys the commands sent to it.
  on('state.set', { key: 'signal' }, async ($, e, next) => {
    const done = await next(e)
    const heard = done.value?.isSet === true ? readSignal(e.value) : null

    if (heard?.kind === 'event' && heard.name === 'roll-call' && Date.now() - sent.answeredAt >= ROLL_CALL_MS) {
      sent.answeredAt = Date.now()
      await emit($, 'announce', 'announce', SELF)
    }

    if (heard?.kind === 'command' && heard.to === MOD) {
      await obey($, heard.name)
    }

    return done
  }).catch((_, e, next) => next(e))

  // The mod's API: `$.taskBars` for any other mod. Each method is answered by its
  // hook below, but `statusChanged`, which is the other mods' to hook.
  on('engine.create', async ($, e, next) => ({
    ...(await next(e)),
    taskBars: {
      open: async () => false,
      close: async () => false,
      toggle: async () => false,
      isOpen: async () => false,
      list: async () => [],
      getStatus: async () => null,
      statusChanged: async () => undefined,
    },
  }))

  on('taskBars.isOpen', async $ => ({ value: !(await read($, isHidden)) }))

  on('taskBars.open', async $ => ({ value: await setHidden($, false) }))

  on('taskBars.close', async $ => ({ value: await setHidden($, true) }))

  on('taskBars.toggle', async $ => ({ value: await setHidden($, !(await read($, isHidden))) }))

  on('taskBars.list', async $ => ({
    value: (await read($, tasks)).map(({ id, name, status, progress }) => ({ id, name, status, progress })),
  }))

  on('taskBars.getStatus', async ($, e) => {
    const list = await read($, tasks)

    return { value: (list.find(one => one.id === e.task) ?? list.find(one => one.name === e.task))?.status ?? null }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show or hide the task progress bars above the prompt',
    })

    await $.command.register({
      name: DEMO_COMMAND,
      description: 'Add or remove sample tasks at different percentages in the task bars',
    })

    await $.tool.register(SET_TASKS)
    await emit($, 'announce', 'announce', SELF)

    return next(e)
  })

  on('tool.call', { tool: 'mcp__task-bars__set_tasks' }, async ($, e) => {
    const input = { ...e }

    if (declared([], input) === undefined) {
      return { deny: `tasks must be a list of { name, status, progress? }, status one of ${TASK_STATUSES.join(', ')}.` }
    }

    await change($, list => declared(list, input) ?? list)

    return { result: 'The task bars are up to date.' }
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    await change($, list => agentCalled(list, e.tool_use_id, { ...e }))
    const ran = await next(e)
    await change($, list =>
      agentAnswered(list, e.tool_use_id, ran.result, ran.deny !== undefined || ran.isError === true),
    )

    return ran
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await change($, list => agentStopped(list, e.agent_id))

    return next(e)
  })

  on('command.run', { command: DEMO_COMMAND }, async $ => {
    const isShown = hasDemo(await read($, tasks))
    await change($, isShown ? withoutDemo : withDemo)

    if (!isShown) {
      await $.taskBars.open()
    }

    return { text: isShown ? 'Sample tasks removed.' : 'Sample tasks added.' }
  })

  on('command.run', { command: COMMAND }, async $ => {
    // The command is one caller of the mod's API among others.
    return { text: (await $.taskBars.toggle()) ? 'Task bars shown.' : 'Task bars hidden.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return { sections: [...composed.sections, PROGRESS_SECTION] }
  })

  on('prompt.submit', async ($, e, next) => {
    await change($, cleared)

    return next(e)
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    await change($, list => created(list, ran.result))

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    await change($, list => updated(list, { ...e }, ran.result))

    return ran
  })

  on('tool.call', { tool: 'TaskList' }, async ($, e, next) => {
    const ran = await next(e)
    await change($, list => listed(list, ran.result))

    return ran
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined && ran.isError !== true) {
      await change($, list => todos(list, { ...e }))
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.reason === 'aborted') {
      await change($, interrupted)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, tasks)

    if (e.props.hasSurvey || list.length === 0 || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const { bodyColumns } = e.props
    const columns = bodyColumns >= MIN_CELL_COLUMNS * 2 + GAP_COLUMNS ? 2 : 1
    const cellColumns = Math.max(
      1,
      Math.min(
        MAX_CELL_COLUMNS,
        Math.floor((bodyColumns - GAP_COLUMNS * (columns - 1)) / columns) - PIN_COLUMNS,
      ),
    )
    const room = Math.max(1, Math.min(MAX_ROWS, e.props.maxRows - 1)) * columns
    const rows = fitting(list, room)
    const lines = Math.ceil(rows.length / columns)

    return (
      <Box flexDirection="column">
        {Array.from({ length: lines }, (_, line) => (
          <Box>
            {/* Column by column: the list reads down the first, then the second. */}
            {Array.from({ length: columns }, (_, column) => rows[column * lines + line]).flatMap(row => {
              if (row === undefined) {
                return []
              }

              const tone = toneOf(row, list)
              const cell = cellOf(row, list, cellColumns)

              return [
                <Box marginRight={GAP_COLUMNS}>
                  <Box width={PIN_COLUMNS}>
                    <Button
                      key={`pin-${row.id}`}
                      plain
                      dimColor={row.isPinned !== true}
                      label={row.isPinned === true ? PINNED : LOOSE}
                      onPress={() => change($, rows => toggled(rows, row.id))}
                    />
                  </Box>
                  {cell.filled.length > 0 && (
                    <Text backgroundColor={tone} color="inverseText">
                      {cell.filled}
                    </Text>
                  )}
                  {cell.rest.length > 0 && <Text color={tone}>{cell.rest}</Text>}
                </Box>,
              ]
            })}
          </Box>
        ))}
        {rows.length < list.length && <Text dimColor>+{list.length - rows.length} altre</Text>}
      </Box>
    )
  })
}
