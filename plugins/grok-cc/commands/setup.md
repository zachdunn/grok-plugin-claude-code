---
description: Check whether the local Grok CLI is installed, signed in, and ready to delegate to
argument-hint: ''
allowed-tools: Bash(node:*), Bash(grok:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" setup
```

Then present the result to the user:

- If it reports the binary as NOT FOUND, tell the user Grok is not installed and show the install hint from the output. Do not attempt the install yourself unless the user asks.
- If it reports `authenticated: no`, tell the user to run `! grok login` (the `!` runs it in their session so the interactive sign-in works), then re-run this command.
- If it reports Grok is ready, confirm that `/grok-cc:rescue` and the `grok-rescue` subagent are good to go.

Do not run any task or delegation as part of setup — this command only checks readiness.
