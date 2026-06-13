---
description: Run a skeptical, adversarial Grok code review against local git state
argument-hint: '[--wait|--background] [--base <ref>] [focus text]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(git:*), AskUserQuestion
---

Run an adversarial Grok review — same as `/grok-cc:review` but Grok assumes the change is wrong until proven otherwise and hunts hard for correctness, security, and edge-case bugs.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:

- Review-only. Do not fix issues or apply patches. Return Grok's output verbatim.

Execution mode:

- Follow the same fg/bg logic as `/grok-cc:review`: honor an explicit `--wait` / `--background`; otherwise estimate size with `git status` / `git diff --shortstat` (or `git diff --shortstat <base>...HEAD`) and `AskUserQuestion` once, recommending background for anything non-trivial.

Run the review with `--adversarial` always set:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" review --adversarial <args>
```

- Pass the user's other arguments through unchanged. For a backgrounded run, use `run_in_background: true`.
- Return the companion's stdout as-is, findings first, ordered by severity.

If the companion reports Grok is unavailable, tell the user to run `/grok-cc:setup`.
