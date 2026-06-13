---
name: grok-result-handling
description: Internal guidance for presenting Grok companion output (delegate results and reviews) back to the user
user-invocable: false
---

# Grok Result Handling

When the `grok-companion` runtime returns Grok output:

- Preserve the companion's structure: header, summary, findings, and next steps.
- For review output, present findings first, kept in the severity order Grok
  returned (blocker → high → medium → low → nit). Do not reorder or re-rank.
- Use the `file:line` locations exactly as Grok reports them.
- Preserve evidence boundaries. If Grok marked something as an inference, an
  uncertainty, or an open question, keep that distinction — do not promote an
  inference to a stated fact.
- Keep the residual-risk note when Grok includes one.
- If there are no findings, say so explicitly and keep the residual-risk note
  brief. Do not invent issues to fill space.
- If a delegate (`task`) run made edits, say so explicitly and list the touched
  files when Grok reports them.
- If a Grok run **failed or was incomplete**, report the failure and stop. Do
  not silently turn a failed Grok run into your own Claude-side implementation
  or a substitute review — the user asked for Grok's work, not a stand-in.
- If Grok was never successfully invoked at all (not installed, not signed in),
  say that and point the user at `/grok-cc:setup`; do not generate a replacement
  answer.
- A review is read-only. Never apply a fix as part of surfacing review output —
  if the user wants the fixes made, that is a separate, explicit step.
