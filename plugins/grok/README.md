# grok (Claude Code plugin)

Delegate coding, debugging, and review tasks to the [Grok CLI](https://grok.com)
from Claude Code — the same shape as the official `codex` plugin, but driving
Grok's headless mode.

## Components

| Component | What it is |
| --- | --- |
| `grok-rescue` subagent | Thin forwarder. Proactively (or on request) hands a substantial task to Grok via the companion. Spawn it with the Agent tool / `@grok-rescue`. |
| `/grok:setup` command | Checks the Grok CLI is installed and signed in. |
| `/grok:rescue` command | One-shot delegation: `/grok:rescue <task>` (plus optional routing flags). |
| `grok-cli-runtime` skill | Reference for how the companion is driven. |
| `scripts/grok-companion.mjs` | The runtime that wraps `grok -p --output-format json`. |

## Requirements

- Grok CLI access ("grok build") — see [x.ai/cli](https://x.ai/cli).
- The `grok` CLI on `PATH` (or at `~/.grok/bin/grok`; override with `GROK_BIN`).
- Signed in: `grok login`. Delegation sends prompts + read code to xAI's backend.
- Node (used to run the companion).

## Usage

```
/grok:setup                       # verify readiness
/grok:rescue fix the failing auth test in apps/api
/grok:rescue --read why is the diorama pan jittery on tilt?
/grok:rescue --background --effort high refactor the camera rig
```

Routing flags (stripped before the task text reaches Grok): `--read`,
`--background`, `--effort <level>`, `--model <id>`, `--cwd <path>`,
`--best-of-n <N>`, `--check`, `--worktree [name]`, `--resume`. Default is a
write-capable foreground run.

## Scope

Lean by design: one-shot delegation, foreground or fire-and-forget background
(returns a log path). No tracked job registry / status / result / cancel surface
— follow background runs via the log file, `grok sessions`, or `grok -c`.

## Install

```bash
claude plugin marketplace add zachdunn/grok-plugin-claude-code
claude plugin install grok@grok-plugin-claude-code
```

Then `/grok:setup` to confirm Grok is installed and signed in. See the
[repo README](../../README.md) for full usage.
