---
description: Delegate a coding, debugging, or review task to the Grok CLI as a parallel worker
argument-hint: '[--read] [--background] [--effort <level>] [--model <id>] <task description>'
allowed-tools: Bash(node:*)
---

Forward the user's request to Grok via the companion runtime. Treat this as a thin hand-off — do not solve the task yourself.

1. Take everything in `$ARGUMENTS` as the task description, except recognized routing flags (`--read`, `--background`, `--effort <level>`, `--model <id>`, `--cwd <path>`, `--best-of-n <N>`, `--check`, `--worktree`, `--resume`), which pass straight through to the companion.
2. If the user gave no routing flags, choose sensible defaults:
   - Write-capable by default. Add `--read` only if the user clearly wants review/diagnosis/research with no edits.
   - Foreground for a small, bounded task; `--background` if it looks long-running or open-ended.
3. Run exactly one command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" task <flags> "<task description>"
```

4. Return the companion's stdout as-is. Do not add your own analysis before or after it.

If the companion reports Grok is not installed or not signed in, tell the user to run `/grok-cc:setup`.
