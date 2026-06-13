#!/usr/bin/env node
// Stop-review-gate hook (OPT-IN, default OFF).
//
// When enabled, this runs a one-shot read-only Grok review of the working tree
// just before Claude Code finishes a turn, and blocks the stop once so the
// review is surfaced. It is deliberately conservative:
//   * Off unless GROK_STOP_REVIEW_GATE is set to a truthy value (1/true/on/yes).
//   * Never loops — if we are already inside a stop-hook continuation
//     (`stop_hook_active`), it exits immediately.
//   * No reviewable change → exits silently.
//   * Any error → exits 0, so a hook failure can never trap the session.
//
// Enable per session:  export GROK_STOP_REVIEW_GATE=1
// It runs a real Grok call (cost + latency), so it is off by default.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function isTruthy(v) {
  return v != null && /^(1|true|on|yes)$/i.test(String(v).trim());
}

function exitQuiet() {
  process.exit(0);
}

try {
  if (!isTruthy(process.env.GROK_STOP_REVIEW_GATE)) exitQuiet();

  let input = {};
  try {
    const raw = readStdin();
    if (raw.trim()) input = JSON.parse(raw);
  } catch {
    // ignore malformed input; fall through with defaults
  }

  // Anti-loop: don't re-gate a stop that this hook already triggered.
  if (input.stop_hook_active) exitQuiet();

  const cwd = input.cwd || process.cwd();

  // Only gate when there is uncommitted work to review.
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
  });
  if (status.status !== 0 || !status.stdout.trim()) exitQuiet();

  const companion = join(
    dirname(fileURLToPath(import.meta.url)),
    "grok-companion.mjs",
  );
  const review = spawnSync(
    process.execPath,
    [companion, "review", "--scope", "working-tree", "--cwd", cwd],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const text = (review.stdout || "").trim();
  if (review.status !== 0 || !text) exitQuiet();

  // Block the stop once and feed the review back so the user/model sees it.
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason:
        text +
        "\n\n(grok stop-review-gate — review only; unset GROK_STOP_REVIEW_GATE to disable.)",
    }) + "\n",
  );
  process.exit(0);
} catch {
  exitQuiet();
}
