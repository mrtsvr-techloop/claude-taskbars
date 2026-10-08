import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { TaskRow } from '../types'
import { cellOf, changesOf, fitting, interrupted, labelOf, percentOf, toneOf } from './model'

/** 100 columns: two columns of bars, each 46 wide beside its pin. */
const BAND = {
  plugin: 'task-bars',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

const DEMO_RUN = {
  command: 'task-bars-demo',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const PROMPT = { text: 'next', wait: false, origin: { kind: 'composer' } } as const

const row = (id: string, over: Partial<TaskRow> = {}): TaskRow => ({
  id,
  name: `task ${id}`,
  status: 'pending',
  blockedBy: [],
  progress: null,
  ...over,
})

type Piece = { text: string; fill: unknown; color: unknown }

/** The band's lines as drawn: each a list of pieces, a bar's fill then its rest. */
const drawn = async ($: Engine, surface: 'terminal' | 'desktop', bodyColumns = 100): Promise<Piece[][]> => {
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface })
  const tree = await ui.drawn()
  await ui.unmount()

  const pieces = (node: unknown): Piece[] => {
    const one = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }

    if (one.type === 'Text') {
      return [
        {
          text: (one.children ?? []).join(''),
          fill: one.props?.backgroundColor,
          color: one.props?.color,
        },
      ]
    }

    return (one.children ?? []).flatMap(pieces)
  }

  return ((tree as { children?: unknown[] }).children ?? []).map(pieces)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: a task is a bar holding its name and percentage, filling as it advances`, async ($, on) => {
    on('tool.call', { tool: 'TaskCreate' }, () => ({ result: { task: { id: '1', subject: 'Build' } } }))
    on('tool.call', { tool: 'TaskUpdate' }, () => ({
      result: { success: true, taskId: '1', updatedFields: ['status'] },
    }))

    await $.tool.call({ tool: 'TaskCreate', subject: 'Build', description: 'Build it' })
    const waiting = (await drawn($, surface))[0] ?? []
    expect(waiting.map(piece => [piece.fill, piece.color])).toEqual([[undefined, 'warning']])
    expect(waiting[0]?.text).toHaveLength(46)
    expect(waiting[0]?.text.startsWith(' Build ')).toBe(true)
    expect(waiting[0]?.text.endsWith(' awaiting 0% ')).toBe(true)

    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress', metadata: { progress: 40 } })
    const running = (await drawn($, surface))[0] ?? []
    expect(running.map(piece => [piece.fill, piece.color, piece.text.length])).toEqual([
      ['success', 'inverseText', 18],
      [undefined, 'success', 28],
    ])
    expect(running.map(piece => piece.text).join('').endsWith(' in corso 40% ')).toBe(true)

    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
    const done = (await drawn($, surface))[0] ?? []
    expect(done.map(piece => [piece.fill, piece.color, piece.text.length])).toEqual([['success', 'inverseText', 46]])
    expect(done[0]?.text.endsWith(' fine 100% ')).toBe(true)
  })
}

test('the tasks the model declares through the mod own tool are drawn, and a bad list is refused', async $ => {
  const answer = await $.tool.call({
    tool: 'mcp__task-bars__set_tasks',
    tasks: [
      { name: 'Plan', status: 'completed' },
      { name: 'Code', status: 'in_progress', progress: 30 },
      { name: 'Ship', status: 'blocked' },
    ],
  })
  expect(answer.deny).toBe(undefined)

  const lines = await drawn($, 'terminal')
  const text = lines.flat().map(piece => piece.text).join('')
  expect(text).toContain(' fine 100% ')
  expect(text).toContain(' in corso 30% ')
  expect(text).toContain(' blocked 0% ')
  expect(lines.flat().filter(piece => piece.text.includes('blocked'))[0]?.color).toBe('error')

  const refused = await $.tool.call({ tool: 'mcp__task-bars__set_tasks', tasks: [{ name: 'No status' } as never] })
  expect(typeof refused.deny).toBe('string')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: a click on a task's pin locks it, and no clean-up removes it until unpinned`, async ($, on) => {
    on('prompt.submit', (_, e) => ({ text: e.text }))
    const declare = (tasks: { name: string; status: 'completed'; persistent?: boolean }[]) =>
      $.tool.call({ tool: 'mcp__task-bars__set_tasks', tasks })

    await declare([{ name: 'Keep', status: 'completed' }, { name: 'Drop', status: 'completed' }])
    const ui = await $.ui.mount({ ...BAND, surface })
    const pins = async () => (await ui.findAll({ type: 'Button' })).map(one => [one.key, one.props.label])
    expect(await pins()).toEqual([
      ['pin-plan-Keep', '○'],
      ['pin-plan-Drop', '○'],
    ])

    await ui.press({ key: 'pin-plan-Keep' })
    expect(await pins()).toEqual([
      ['pin-plan-Keep', '📌'],
      ['pin-plan-Drop', '○'],
    ])

    // The model's empty list, then the prompt after every loose task is done.
    await declare([])
    expect(await pins()).toEqual([['pin-plan-Keep', '📌']])
    await declare([{ name: 'Drop', status: 'completed' }])
    await $.prompt.submit(PROMPT)
    expect(await pins()).toEqual([['pin-plan-Keep', '📌']])

    await ui.press({ key: 'pin-plan-Keep' })
    expect(await pins()).toEqual([['pin-plan-Keep', '○']])
    await ui.unmount()
  })
}

test('the model pins a task by declaring it persistent, and cannot unpin it', async $ => {
  await $.tool.call({
    tool: 'mcp__task-bars__set_tasks',
    tasks: [{ name: 'Release', status: 'in_progress', progress: 20, persistent: true }],
  })
  await $.tool.call({
    tool: 'mcp__task-bars__set_tasks',
    tasks: [{ name: 'Release', status: 'in_progress', progress: 60, persistent: false }],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Button' })).map(one => one.props.label)).toEqual(['📌'])
  expect((await drawn($, 'terminal')).flat().map(piece => piece.text).join('')).toContain(' in corso 60% ')
})

test('a subagent is a running bar from its launch, done when it stops', async ($, on) => {
  on('tool.call', { tool: 'Agent' }, () => ({
    result: { status: 'async_launched', agentId: 'a1', description: 'Review the diff', prompt: 'p', outputFile: 'o' },
  }))
  on('classic.SubagentStop', () => ({}))

  await $.tool.call({ tool: 'Agent', description: 'Review the diff', prompt: 'p' })
  const running = (await drawn($, 'terminal')).flat().map(piece => piece.text).join('')
  expect(running).toContain(' Review the diff ')
  expect(running).toContain(' in corso 50% ')

  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1', agent_transcript_path: 't', agent_type: 'reviewer' })
  const done = (await drawn($, 'terminal')).flat().map(piece => piece.text).join('')
  expect(done).toContain(' fine 100% ')
})

test('a todo list is drawn one bar per todo', async ($, on) => {
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Read', status: 'completed', activeForm: 'Reading' },
      { content: 'Write', status: 'in_progress', activeForm: 'Writing' },
    ],
  })

  const [line] = await drawn($, 'terminal')
  const text = (line ?? []).map(piece => piece.text).join('')

  expect(text).toContain(' Read ')
  expect(text).toContain(' fine 100% ')
  expect(text).toContain(' Write ')
  expect(text).toContain(' in corso 50% ')
})

test('the demo tasks fill two columns down, and one column where the band is narrow', async $ => {
  const percents = (lines: Piece[][]) =>
    lines.map(line => (line.map(piece => piece.text).join('').match(/\d+%/g) ?? []).join(' '))

  await $.command.run(DEMO_RUN)
  expect(percents(await drawn($, 'terminal'))).toEqual(['100% 0%', '82% 0%', '47% 63%', '15%'])
  expect(percents(await drawn($, 'terminal', 50))).toEqual(['100%', '82%', '47%', '15%', '0%', '0%', '63%'])

  // With no row left the band is handed on, and nothing beneath the mod draws it.
  await $.command.run(DEMO_RUN)
  await expect(drawn($, 'terminal')).rejects.toThrow('no implementation for ui.render')
})

test('the bar is green running or done, orange awaiting, red blocked or stopped', () => {
  const blocker = row('1', { status: 'in_progress', progress: 30 })
  const blocked = row('2', { blockedBy: ['1'] })
  const waiting = row('3')
  const done = row('4', { status: 'completed' })
  const [stopped] = interrupted([blocker])
  const list = [blocker, blocked, waiting, done]

  expect([toneOf(blocker, list), labelOf(blocker, list), percentOf(blocker)]).toEqual(['success', 'in corso', 30])
  expect([toneOf(blocked, list), labelOf(blocked, list), percentOf(blocked)]).toEqual(['error', 'blocked', 0])
  expect([toneOf(waiting, list), labelOf(waiting, list), percentOf(waiting)]).toEqual(['warning', 'awaiting', 0])
  expect([toneOf(done, list), labelOf(done, list), percentOf(done)]).toEqual(['success', 'fine', 100])
  expect(stopped && [toneOf(stopped, list), labelOf(stopped, list)]).toEqual(['error', 'stopped'])
})

test('a bar keeps its width, cuts a long name and drops the label where it is narrow', () => {
  const task = row('1', { name: 'A very long task name indeed', status: 'in_progress', progress: 50 })

  expect(cellOf(task, [task], 20)).toEqual({ filled: ' A very lo', rest: 'ng t… 50% ' })

  const wide = cellOf(task, [task], 40)
  expect([wide.filled.length, wide.rest.length]).toEqual([20, 20])
  expect(`${wide.filled}${wide.rest}`).toBe(' A very long task name in… in corso 50% ')

  const list = [row('1', { status: 'completed' }), row('2'), row('3', { status: 'completed' }), row('4')]
  expect(fitting(list, 3).map(one => one.id)).toEqual(['1', '2', '4'])
})

test('other mods follow the tasks: each change of status reaches the hooks on taskBars.statusChanged', async ($, on) => {
  const seen: unknown[] = []
  on('taskBars.statusChanged', (_, e) => {
    seen.push(e)

    return { value: undefined }
  })
  const declare = (tasks: unknown[]) => $.tool.call({ tool: 'mcp__task-bars__set_tasks', tasks } as never)

  await declare([{ name: 'Build', status: 'pending' }])
  await declare([{ name: 'Build', status: 'in_progress', progress: 40 }])
  // Progress alone is no change of status.
  await declare([{ name: 'Build', status: 'in_progress', progress: 80 }])
  await declare([{ name: 'Build', status: 'completed' }])

  expect(seen.map(one => { const { from, to, name } = one as { from: unknown; to: unknown; name: unknown }; return [name, from, to] })).toEqual([
    ['Build', null, 'pending'],
    ['Build', 'pending', 'in_progress'],
    ['Build', 'in_progress', 'completed'],
  ])
})

test('the changes between two lists are the statuses that moved, with what appeared and what left', () => {
  const before = [row('a', { status: 'pending' }), row('b', { status: 'in_progress' }), row('c')]
  const after = [row('a', { status: 'in_progress' }), row('b', { status: 'in_progress', progress: 50 }), row('d')]

  expect(changesOf(before, after)).toEqual([
    { id: 'a', name: 'task a', from: 'pending', to: 'in_progress' },
    { id: 'd', name: 'task d', from: null, to: 'pending' },
    { id: 'c', name: 'task c', from: 'pending', to: null },
  ])
})
