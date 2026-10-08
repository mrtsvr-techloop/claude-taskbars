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

The task list (`TaskCreate`, `TaskUpdate`, `TaskList`) and the todos of `TodoWrite`. Background
shells, subagents and monitors are not tracked.

Claude Code exposes no progress for a task, so the mod adds a section to the system prompt asking
the model to report it with `TaskUpdate` and `metadata: { "progress": <0-100> }`. Until the model
does, a started task sits at 50%; a todo is always at 0, 50 or 100.

While it draws, the mod takes the band above the prompt in place of other mods drawing there.

## Develop

```
claude plugin validate .
claude plugin test .
```

Architecture: `hooks/register.tsx` is the adapter (the hooks on Claude Code's events and the
drawing), `hooks/model.ts` the pure task model it calls, `types/index.d.ts` the state contract.
