# grok-plugin-claude-code

A lightweight [Claude Code](https://claude.com/claude-code) plugin that lets you
delegate coding, debugging, and review tasks to the [Grok CLI](https://grok.com)
— spawn a `grok-rescue` subagent or run `/grok:rescue <task>` and Grok works the
problem as a parallel agent.

> This is essentially a simple, unofficial reimplementation of OpenAI's
> [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) — same shape
> (a thin forwarder subagent + slash commands + a companion runtime), pointed at
> the Grok CLI instead of Codex. It is intentionally leaner: it wraps Grok's
> one-shot headless mode rather than a long-running app-server, so there is no
> tracked-job registry / status / result / cancel surface.

## What you get

| Component | What it does |
| --- | --- |
| `grok-rescue` subagent | Thin forwarder. Hand it a substantial task (via the Agent tool / `@grok-rescue`) and it delegates to Grok. |
| `/grok:rescue <task>` | One-shot delegation with optional routing flags. |
| `/grok:setup` | Verifies the Grok CLI is installed and signed in. |
| `grok-cli-runtime` skill | Reference for how the companion drives Grok. |
| `grok-companion.mjs` | The runtime that wraps `grok -p --output-format json`. |

## Requirements

- **Grok CLI access.** This plugin drives xAI's Grok CLI ("grok build"), which
  requires access — see [x.ai/cli](https://x.ai/cli). Without it the plugin has
  nothing to delegate to.
- The `grok` CLI on your `PATH` (or at `~/.grok/bin/grok`; override with the
  `GROK_BIN` env var).
- Signed in: `grok login`.
- Node (used to run the companion script).

> Delegation sends your prompt and any code Grok reads to xAI's backend — the
> same external-service caveat as any cloud coding agent.

## Install

From within Claude Code:

```text
/plugin marketplace add zachdunn/grok-plugin-claude-code
/plugin install grok@grok-plugin-claude-code
```

Or with the CLI:

```bash
claude plugin marketplace add zachdunn/grok-plugin-claude-code
claude plugin install grok@grok-plugin-claude-code
```

Then `/grok:setup` to confirm Grok is ready.

## Usage

```text
/grok:rescue fix the failing auth test in apps/api
/grok:rescue --read why is the diorama pan jittery on tilt?
/grok:rescue --background --effort high refactor the camera rig
```

Routing flags (stripped before the task text reaches Grok):

| Flag | Effect |
| --- | --- |
| _(default)_ | write-capable run — Grok may edit files |
| `--read` | read-only (plan mode); reads and reasons, no edits |
| `--background` | spawn detached; returns a pid + log path |
| `--effort <level>` | `low \| medium \| high \| xhigh \| max` |
| `--model <id>` | pin a specific Grok model |
| `--cwd <path>` | working directory (default: current) |
| `--best-of-n <N>` | run N ways in parallel, keep the best |
| `--check` | append a self-verification pass |
| `--worktree [name]` | run inside a fresh git worktree |
| `--resume` | continue the most recent Grok session here |

## Repo layout

```text
.claude-plugin/marketplace.json   # marketplace manifest
plugins/grok/                     # the plugin itself
  .claude-plugin/plugin.json
  agents/grok-rescue.md
  commands/{setup,rescue}.md
  skills/grok-cli-runtime/SKILL.md
  scripts/grok-companion.mjs
```

## License

[MIT](./LICENSE). Not affiliated with xAI or OpenAI.
