---
name: grok-cli-runtime
description: How to delegate tasks to the Grok CLI from Claude Code via the grok-companion runtime. Use when forwarding a coding, debugging, or review task to Grok, when driving `grok` headlessly, or when the grok-rescue subagent or /grok:rescue command needs to invoke the companion. Covers task vs read-only runs, foreground vs background, and routing flags.
---

# Grok CLI runtime

Delegate work to the Grok CLI through one companion script. The companion wraps
Grok's headless `-p/--single` mode (a one-shot process that prints a JSON result
and exits) so Claude Code gets a clean, non-blocking hand-off.

## The one entry point

Always invoke the companion — never call `grok` directly from the delegation
path:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" <setup|task> [args]
```

`${CLAUDE_PLUGIN_ROOT}` resolves to this plugin's root, so the path is portable.

## Readiness

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" setup
```

Reports the resolved `grok` binary, version, and whether `~/.grok/auth.json`
exists (sign-in state). Exit 0 = ready. If not signed in, the user runs
`! grok login` themselves (interactive). Add `--json` for machine-readable output.

## Delegating a task

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" task [routing flags] "<task text>"
```

The task text is the trailing argument. Routing flags come first and are
stripped before the text reaches Grok:

| Flag | Effect |
| --- | --- |
| _(default)_ | write-capable run — Grok may edit files (`--always-approve`, non-blocking) |
| `--read` | read-only — plan mode; Grok reads and reasons but does not mutate |
| `--background` | spawn detached; returns a pid + log path instead of waiting |
| `--effort <level>` | `low \| medium \| high \| xhigh \| max` |
| `--model <id>` | pin a specific Grok model (omit to use the default) |
| `--cwd <path>` | working directory (defaults to the current directory) |
| `--best-of-n <N>` | run the task N ways in parallel, keep the best |
| `--check` | append a self-verification pass to the run |
| `--worktree [name]` | run inside a fresh git worktree |
| `--resume` | continue the most recent Grok session in this directory |

### Foreground vs background

- **Foreground** (default): small, bounded asks. The companion waits, parses the
  JSON result, and prints `text` + `sessionId`. Continue the thread later with
  `grok -c` in the same directory.
- **Background** (`--background`): long, open-ended, or multi-step work. The
  companion spawns a detached process, prints the pid and a log file path, and
  returns immediately. The full JSON result lands in the log when Grok finishes;
  `tail -f` it to watch.

## Notes

- Grok prints noisy `AuthorizationRequired` lines on **stderr** from a
  background worker even on success. The companion keys off the **exit code and
  stdout JSON**, not stderr, and only surfaces stderr on failure. Do the same if
  you ever read Grok output directly.
- Delegating sends the prompt and any code context Grok reads to xAI's backend —
  the same external-service caveat as any cloud coding agent.
- This runtime is intentionally lean: one-shot runs only, no tracked job
  registry and no status/result/cancel surface. Use `--background` + the log
  file, or `grok sessions` / `grok -c`, to follow up.
