#!/usr/bin/env node
// grok-companion — thin runtime that drives the headless Grok CLI on behalf of
// the Claude Code `grok` plugin. Mirrors the role of codex-companion.mjs but is
// deliberately lean: Grok's `-p/--single` headless mode is a one-shot process,
// so there is no long-running broker and no tracked-job registry. Subcommands:
// `setup`, `task`, and `review`.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync, openSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const HOME = homedir();

function resolveGrokBin() {
  if (process.env.GROK_BIN && existsSync(process.env.GROK_BIN)) {
    return process.env.GROK_BIN;
  }
  // Prefer PATH, fall back to the default install location.
  const onPath = spawnSync("which", ["grok"], { encoding: "utf8" });
  if (onPath.status === 0) {
    const p = onPath.stdout.trim();
    if (p) return p;
  }
  const fallback = join(HOME, ".grok", "bin", "grok");
  if (existsSync(fallback)) return fallback;
  return null;
}

function grokVersion(bin) {
  if (!bin) return null;
  const r = spawnSync(bin, ["version"], { encoding: "utf8" });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  return out || null;
}

function isAuthenticated() {
  const authPath = join(HOME, ".grok", "auth.json");
  try {
    return existsSync(authPath) && statSync(authPath).size > 0
      ? authPath
      : null;
  } catch {
    return null;
  }
}

function requireReady() {
  const bin = resolveGrokBin();
  if (!bin) {
    process.stdout.write(
      "grok CLI not found. Run the /grok:setup command first.\n",
    );
    process.exit(1);
  }
  if (!isAuthenticated()) {
    process.stdout.write(
      "grok is not signed in. Run `! grok login`, then retry.\n",
    );
    process.exit(1);
  }
  return bin;
}

// ---- shared run ------------------------------------------------------------

// Spawn grok with the given args. In foreground mode, capture stdout, render a
// clean summary, and exit with grok's code. In background mode, detach and
// print a pid + log path.
function executeGrok(bin, grokArgs, cwd, { background, label, render }) {
  if (background) {
    const logDir = join(tmpdir(), "grok-delegate");
    try {
      mkdirSync(logDir, { recursive: true });
    } catch {}
    const logFile = join(logDir, `grok-${process.pid}.log`);
    const fd = openSync(logFile, "a");
    const child = spawn(bin, grokArgs, {
      cwd,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
    process.stdout.write(
      [
        `=== grok ${label} (background) ===`,
        `pid:     ${child.pid}`,
        `cwd:     ${cwd}`,
        `log:     ${logFile}`,
        "",
        `Running in the background. Tail the log to watch:`,
        `  tail -f ${logFile}`,
        `When it finishes, the JSON result (incl. text + sessionId) is in that file.`,
        "",
      ].join("\n") + "\n",
    );
    process.exit(0);
  }

  const child = spawn(bin, grokArgs, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (err += d.toString()));
  child.on("error", (e) => {
    process.stdout.write(`Failed to launch grok: ${e.message}\n`);
    process.exit(1);
  });
  child.on("close", (code) => {
    if (code === 0 && out.trim()) {
      process.stdout.write(render(out));
      process.exit(0);
    }
    // grok's stderr is noisy (background-worker auth lines) even on success, so
    // only surface it on failure.
    process.stdout.write(
      [
        `=== grok ${label} failed ===`,
        `exit code: ${code}`,
        out.trim() ? `\nstdout:\n${out.trim()}` : "",
        err.trim()
          ? `\nstderr (tail):\n${err.trim().split("\n").slice(-8).join("\n")}`
          : "",
        "",
      ].join("\n") + "\n",
    );
    process.exit(code || 1);
  });
}

function parseResult(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---- setup ----------------------------------------------------------------

function runSetup(argv) {
  const json = argv.includes("--json");
  const bin = resolveGrokBin();
  const version = grokVersion(bin);
  const authPath = isAuthenticated();
  const ready = Boolean(bin && authPath);

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: ready,
          binary: bin,
          version,
          authenticated: Boolean(authPath),
          authPath,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    const lines = [];
    lines.push(`grok binary:   ${bin || "NOT FOUND"}`);
    lines.push(`grok version:  ${version || "unknown"}`);
    lines.push(`authenticated: ${authPath ? "yes" : "no"}`);
    if (!bin) {
      lines.push("");
      lines.push("Grok CLI not found. It requires Grok access — see x.ai/cli.");
    } else if (!authPath) {
      lines.push("");
      lines.push("Grok is installed but not signed in. Run:");
      lines.push("  ! grok login");
    } else {
      lines.push("");
      lines.push("Grok is ready to delegate to.");
    }
    process.stdout.write(lines.join("\n") + "\n");
  }
  process.exit(ready ? 0 : 1);
}

// ---- task -----------------------------------------------------------------

const TASK_VALUE_FLAGS = new Set(["--effort", "--model", "--cwd", "--best-of-n"]);
const TASK_BOOL_FLAGS = new Set([
  "--background",
  "--wait",
  "--write",
  "--read",
  "--check",
  "--resume",
]);

function parseTaskArgs(argv) {
  const opts = {
    background: false,
    read: false,
    check: false,
    resume: false,
    effort: null,
    model: null,
    cwd: null,
    bestOfN: null,
    worktree: undefined,
  };
  const promptParts = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--worktree" || a === "-w") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        opts.worktree = next;
        i++;
      } else {
        opts.worktree = null;
      }
    } else if (TASK_VALUE_FLAGS.has(a)) {
      const next = argv[++i];
      if (a === "--effort") opts.effort = next;
      else if (a === "--model") opts.model = next;
      else if (a === "--cwd") opts.cwd = next;
      else if (a === "--best-of-n") opts.bestOfN = next;
    } else if (TASK_BOOL_FLAGS.has(a)) {
      if (a === "--background") opts.background = true;
      else if (a === "--read") opts.read = true;
      else if (a === "--check") opts.check = true;
      else if (a === "--resume") opts.resume = true;
      // --wait and --write are the defaults; accepted for clarity, no-op.
    } else {
      promptParts.push(a);
    }
  }
  opts.prompt = promptParts.join(" ").trim();
  return opts;
}

function buildTaskArgs(opts) {
  const args = ["-p", opts.prompt, "--output-format", "json"];
  if (opts.read) args.push("--permission-mode", "plan");
  else args.push("--always-approve");
  if (opts.effort) args.push("--effort", opts.effort);
  if (opts.model) args.push("--model", opts.model);
  if (opts.cwd) args.push("--cwd", opts.cwd);
  if (opts.bestOfN) args.push("--best-of-n", String(opts.bestOfN));
  if (opts.check) args.push("--check");
  if (opts.resume) args.push("-c");
  if (opts.worktree !== undefined) {
    if (opts.worktree) args.push("--worktree", opts.worktree);
    else args.push("--worktree");
  }
  return args;
}

function renderTask(raw, opts) {
  const parsed = parseResult(raw);
  if (!parsed) return raw.trimEnd() + "\n";
  const lines = [];
  lines.push("=== grok delegate result ===");
  lines.push(`mode:    ${opts.read ? "read-only (plan)" : "write-capable"}`);
  if (opts.model) lines.push(`model:   ${opts.model}`);
  if (opts.effort) lines.push(`effort:  ${opts.effort}`);
  if (parsed.stopReason) lines.push(`stop:    ${parsed.stopReason}`);
  if (parsed.sessionId) lines.push(`session: ${parsed.sessionId}`);
  lines.push("");
  lines.push(parsed.text ?? "(no text returned)");
  if (parsed.sessionId) {
    lines.push("");
    lines.push(
      `Continue this thread: grok -c   (in ${opts.cwd || "the same directory"})`,
    );
  }
  return lines.join("\n") + "\n";
}

function runTask(argv) {
  const bin = requireReady();
  const opts = parseTaskArgs(argv);
  if (!opts.prompt) {
    process.stdout.write("No task text provided to grok-companion task.\n");
    process.exit(1);
  }
  const cwd = opts.cwd || process.cwd();
  executeGrok(bin, buildTaskArgs(opts), cwd, {
    background: opts.background,
    label: "delegate",
    render: (raw) => renderTask(raw, opts),
  });
}

// ---- review ---------------------------------------------------------------

const REVIEW_VALUE_FLAGS = new Set([
  "--base",
  "--scope",
  "--effort",
  "--model",
  "--cwd",
]);
const REVIEW_BOOL_FLAGS = new Set(["--background", "--wait", "--adversarial"]);

function parseReviewArgs(argv) {
  const opts = {
    background: false,
    adversarial: false,
    base: null,
    scope: "auto",
    effort: null,
    model: null,
    cwd: null,
  };
  const focusParts = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (REVIEW_VALUE_FLAGS.has(a)) {
      const next = argv[++i];
      if (a === "--base") opts.base = next;
      else if (a === "--scope") opts.scope = next;
      else if (a === "--effort") opts.effort = next;
      else if (a === "--model") opts.model = next;
      else if (a === "--cwd") opts.cwd = next;
    } else if (REVIEW_BOOL_FLAGS.has(a)) {
      if (a === "--background") opts.background = true;
      else if (a === "--adversarial") opts.adversarial = true;
      // --wait is the default; accepted for clarity.
    } else {
      focusParts.push(a);
    }
  }
  opts.focus = focusParts.join(" ").trim();
  // Resolve scope: an explicit base implies a branch review.
  if (opts.scope === "auto") {
    opts.scope = opts.base ? "branch" : "working-tree";
  }
  if (opts.scope === "branch" && !opts.base) opts.base = "main";
  return opts;
}

const MAX_DIFF_CHARS = 100_000;

// Gather the diff to review. We collect it here (rather than asking grok to run
// git) because grok's read-only plan mode blocks the shell tool it would need —
// embedding the diff keeps the review genuinely read-only and tool-free.
function gatherDiff(opts, cwd) {
  const git = (args) => {
    const r = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return r.status === 0 || r.stdout ? r.stdout || "" : "";
  };
  let summary = "";
  let patch = "";
  if (opts.scope === "branch") {
    summary = git(["diff", `${opts.base}...HEAD`, "--stat"]);
    patch = git(["diff", `${opts.base}...HEAD`]);
  } else {
    summary = git(["status", "--short", "--untracked-files=all"]);
    patch = git(["diff", "HEAD"]); // staged + unstaged tracked changes
    // Append untracked files as add-only diffs (no index mutation).
    for (const line of summary.split("\n")) {
      if (line.startsWith("?? ")) {
        const path = line.slice(3).trim();
        if (path) patch += "\n" + git(["diff", "--no-index", "/dev/null", path]);
      }
    }
  }
  let combined = `# Change summary\n${summary.trim()}\n\n# Diff\n${patch.trim()}`;
  let truncated = false;
  if (combined.length > MAX_DIFF_CHARS) {
    combined = combined.slice(0, MAX_DIFF_CHARS);
    truncated = true;
  }
  return { text: combined, truncated, empty: !summary.trim() && !patch.trim() };
}

function buildReviewPrompt(opts, diff) {
  const lines = [];
  lines.push(
    "You are performing a READ-ONLY code review. Do NOT edit, create, or delete any files — only inspect and report.",
  );
  lines.push("");
  lines.push(
    opts.scope === "branch"
      ? `Scope: the changes on the current branch relative to \`${opts.base}\`.`
      : "Scope: the uncommitted working-tree changes.",
  );
  lines.push(
    "Base your review solely on the diff below. Do NOT use any tools (no shell, no file reads) — review the diff as given and answer directly with your findings as text.",
  );
  if (diff.truncated) {
    lines.push(
      "(NOTE: the diff was truncated for length — review what is shown and flag that coverage is partial.)",
    );
  }
  lines.push("");
  lines.push("```diff");
  lines.push(diff.text);
  lines.push("```");
  lines.push("");
  if (opts.adversarial) {
    lines.push(
      "Be adversarial: assume the change is wrong until proven otherwise. Actively hunt for correctness bugs, security issues, race conditions, broken error handling, and missed edge cases. Prefer a few high-confidence, concrete findings over a long shallow list.",
    );
    lines.push("");
  }
  lines.push(
    "Report findings ordered by severity (blocker, high, medium, low, nit). For each finding give:",
  );
  lines.push("- `file:line` — the precise location");
  lines.push("- what the issue is, and why it matters");
  lines.push("- a concrete suggested fix");
  lines.push(
    "Distinguish observed facts from inferences. End with a one-line residual-risk note. If you find no real issues, say so explicitly and keep the residual-risk note brief.",
  );
  if (opts.focus) {
    lines.push("");
    lines.push(`Reviewer focus from the user: ${opts.focus}`);
  }
  return lines.join("\n");
}

function buildReviewGrokArgs(opts, diff) {
  // Plan mode = read-only: grok cannot mutate. The diff is embedded in the
  // prompt so no shell tool is needed to obtain it.
  const args = [
    "-p",
    buildReviewPrompt(opts, diff),
    "--output-format",
    "json",
    "--permission-mode",
    "plan",
  ];
  if (opts.effort) args.push("--effort", opts.effort);
  if (opts.model) args.push("--model", opts.model);
  if (opts.cwd) args.push("--cwd", opts.cwd);
  return args;
}

function renderReview(raw, opts) {
  const parsed = parseResult(raw);
  if (!parsed) return raw.trimEnd() + "\n";
  const lines = [];
  lines.push(`=== grok ${opts.adversarial ? "adversarial " : ""}review ===`);
  lines.push(
    `scope:   ${opts.scope === "branch" ? `branch vs ${opts.base}` : "working tree"}`,
  );
  if (opts.model) lines.push(`model:   ${opts.model}`);
  if (parsed.sessionId) lines.push(`session: ${parsed.sessionId}`);
  lines.push("");
  lines.push(parsed.text ?? "(no review text returned)");
  return lines.join("\n") + "\n";
}

function runReview(argv) {
  const bin = requireReady();
  const opts = parseReviewArgs(argv);
  const cwd = opts.cwd || process.cwd();
  const diff = gatherDiff(opts, cwd);
  if (diff.empty) {
    process.stdout.write(
      `=== grok review ===\nNothing to review — no ${opts.scope === "branch" ? `changes vs ${opts.base}` : "uncommitted changes"} found.\n`,
    );
    process.exit(0);
  }
  executeGrok(bin, buildReviewGrokArgs(opts, diff), cwd, {
    background: opts.background,
    label: opts.adversarial ? "adversarial review" : "review",
    render: (raw) => renderReview(raw, opts),
  });
}

// ---- dispatch -------------------------------------------------------------

const [, , sub, ...rest] = process.argv;
switch (sub) {
  case "setup":
    runSetup(rest);
    break;
  case "task":
    runTask(rest);
    break;
  case "review":
    runReview(rest);
    break;
  default:
    process.stdout.write(
      [
        "grok-companion — drive the headless Grok CLI",
        "",
        "Usage:",
        "  node grok-companion.mjs setup [--json]",
        "  node grok-companion.mjs task [routing flags] <task text>",
        "  node grok-companion.mjs review [--base <ref>] [--scope auto|working-tree|branch]",
        "                                 [--adversarial] [--background] [focus text]",
        "",
        "task routing flags:",
        "  --read | --background | --effort <l> | --model <id> | --cwd <p>",
        "  --best-of-n <N> | --check | --worktree [name] | --resume",
        "",
        "review is always read-only (plan mode).",
        "",
      ].join("\n") + "\n",
    );
    process.exit(sub ? 1 : 0);
}
