---
description: Run a read-only Grok code review against local git state
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [focus text]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(git:*), AskUserQuestion
---

Run a Grok code review through the companion runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:

- This command is review-only. Do not fix issues, apply patches, or imply you are about to make changes.
- Your only job is to run the review and return Grok's output verbatim to the user.

Execution mode:

- If the arguments include `--wait`, run in the foreground without asking.
- If the arguments include `--background`, run as a Claude background task without asking.
- Otherwise, estimate the review size first:
  - For a working-tree review (no `--base`), run `git status --short --untracked-files=all`, `git diff --shortstat`, and `git diff --shortstat --cached`. Treat untracked files as reviewable work even when the diff stat is empty.
  - For a branch review (`--base <ref>` given), run `git diff --shortstat <ref>...HEAD`.
  - Only conclude there is nothing to review when the relevant status and diff are genuinely empty.
  - Recommend waiting only when the change is clearly tiny (~1-2 files). In every other case, including unclear size, recommend background.
  - Use `AskUserQuestion` exactly once with two options, recommended option first and suffixed `(Recommended)`: `Wait for results` and `Run in background`.

Run the review:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" review <args>
```

- Pass the user's arguments through unchanged (the companion parses `--base`, `--scope`, `--adversarial`, `--background`, and trailing focus text). Do not rewrite the user's intent.
- For a backgrounded run, invoke the Bash call with `run_in_background: true`.
- Return the companion's stdout as-is, findings first, ordered by severity. Do not add your own analysis.

If the companion reports Grok is not installed or not signed in, tell the user to run `/grok-cc:setup`. For deeper, skeptical review, point them at `/grok-cc:adversarial-review`.
