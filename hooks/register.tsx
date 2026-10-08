import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { hasDemo, withDemo, withoutDemo } from './demo'
import {
  agentAnswered,
  agentCalled,
  agentStopped,
  cellOf,
  created,
  declared,
  fitting,
  interrupted,
  isAllDone,
  listed,
  todos,
  toneOf,
  updated,
} from './model'

const COMMAND = 'task-bars'
const DEMO_COMMAND = 'task-bars-demo'
const MAX_ROWS = 10
/** Two columns of bars from the width that gives each this much. */
const MIN_CELL_COLUMNS = 30
const MAX_CELL_COLUMNS = 60
const GAP_COLUMNS = 2

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
    'whole list every time: it replaces the one shown before; an empty list clears it.',
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

export const register: Register = on => {
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

    return next(e)
  })

  on('tool.call', { tool: 'mcp__task-bars__set_tasks' }, async ($, e) => {
    const input = { ...e }

    if (declared([], input) === undefined) {
      return { deny: `tasks must be a list of { name, status, progress? }, status one of ${TASK_STATUSES.join(', ')}.` }
    }

    await update($, tasks, list => declared(list, input) ?? list)

    return { result: 'The task bars are up to date.' }
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    await update($, tasks, list => agentCalled(list, e.tool_use_id, { ...e }))
    const ran = await next(e)
    await update($, tasks, list =>
      agentAnswered(list, e.tool_use_id, ran.result, ran.deny !== undefined || ran.isError === true),
    )

    return ran
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await update($, tasks, list => agentStopped(list, e.agent_id))

    return next(e)
  })

  on('command.run', { command: DEMO_COMMAND }, async $ => {
    const isShown = hasDemo(await read($, tasks))
    await update($, tasks, isShown ? withoutDemo : withDemo)

    if (!isShown) {
      await update($, isHidden, () => false)
    }

    return { text: isShown ? 'Sample tasks removed.' : 'Sample tasks added.' }
  })

  on('command.run', { command: COMMAND }, async $ => {
    const hidden = !(await read($, isHidden))
    await update($, isHidden, () => hidden)

    return { text: hidden ? 'Task bars hidden.' : 'Task bars shown.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return { sections: [...composed.sections, PROGRESS_SECTION] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (isAllDone(await read($, tasks))) {
      await update($, tasks, () => [])
    }

    return next(e)
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    await update($, tasks, list => created(list, ran.result))

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    await update($, tasks, list => updated(list, { ...e }, ran.result))

    return ran
  })

  on('tool.call', { tool: 'TaskList' }, async ($, e, next) => {
    const ran = await next(e)
    await update($, tasks, list => listed(list, ran.result))

    return ran
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined && ran.isError !== true) {
      await update($, tasks, list => todos(list, { ...e }))
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.reason === 'aborted') {
      await update($, tasks, interrupted)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, tasks)

    if (e.props.hasSurvey || list.length === 0 || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const { bodyColumns } = e.props
    const columns = bodyColumns >= MIN_CELL_COLUMNS * 2 + GAP_COLUMNS ? 2 : 1
    const cellColumns = Math.max(
      1,
      Math.min(MAX_CELL_COLUMNS, Math.floor((bodyColumns - GAP_COLUMNS * (columns - 1)) / columns)),
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
