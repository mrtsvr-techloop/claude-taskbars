# task-bars

A Claude Code mod that shows the session's tasks above the prompt as progress bars.

Each task is one bar holding its name, its state and its percentage; the bars sit in two
columns where the terminal is wide enough.

| Color  | State                                                            |
| ------ | ---------------------------------------------------------------- |
| Green  | running (the bar grows) or done (100%)                           |
| Orange | awaiting                                                         |
| Red    | blocked by an unfinished task, or stopped by an interrupted turn |

The colors are the theme's `success`, `warning` and `error`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install task-bars --marketplace mrtsvr-techloop/claude-taskbars
```

Answer `y` to add the marketplace, then pick a scope.

To run it from a clone instead: `claude --plugin-dir <path to the clone>`.

## Commands

- `/task-bars` hides or shows the bars.
- `/task-bars-demo` adds or removes sample tasks at different percentages.

## What it tracks

The bars appear by themselves; nobody asks for them. Four sources feed them:

- the mod's own tool, `mcp__task-bars__set_tasks`, which the model calls with the whole list of
  tasks of its current work; it is what feeds the bars where the session offers no task list;
- the task list (`TaskCreate`, `TaskUpdate`, `TaskList`);
- the todos of `TodoWrite`;
- the subagents the model launches with `Agent`: running from the launch, done when they stop.

Background shells and monitors are not tracked.

The mod adds a section to the system prompt asking the model to keep the bars current and to give
each running task its progress (0-100). A running task with no reported progress sits at 50%: a
subagent always does, and a todo is always at 0, 50 or 100.

While it draws, the mod takes the band above the prompt in place of other mods drawing there.

## Develop

```
claude plugin validate .
claude plugin test .
```

Architecture: `hooks/register.tsx` is the adapter (the hooks on Claude Code's events and the
drawing), `hooks/model.ts` the pure task model it calls, `types/index.d.ts` the state contract.
