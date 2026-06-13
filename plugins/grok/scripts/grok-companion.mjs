#!/usr/bin/env node
// grok-companion — thin runtime that drives the headless Grok CLI on behalf of
// the Claude Code `grok` plugin. Mirrors the role of codex-companion.mjs but is
// deliberately lean: Grok's `-p/--single` headless mode is a one-shot process,
// so there is no long-running broker, no job registry, and no status/result/
// cancel surface. Two subcommands: `setup` and `task`.

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
      lines.push("Grok CLI not found. Install it, e.g.:");
      lines.push("  curl -fsSL https://grok.com/install.sh | bash");
      lines.push("(or `npm i -g @vibe-kit/grok` if you use the npm build)");
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

const VALUE_FLAGS = new Set([
  "--effort",
  "--model",
  "--cwd",
  "--best-of-n",
]);
const BOOL_FLAGS = new Set([
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
    worktree: undefined, // undefined = unset, null = bare flag, string = named
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
    } else if (VALUE_FLAGS.has(a)) {
      const next = argv[++i];
      if (a === "--effort") opts.effort = next;
      else if (a === "--model") opts.model = next;
      else if (a === "--cwd") opts.cwd = next;
      else if (a === "--best-of-n") opts.bestOfN = next;
    } else if (BOOL_FLAGS.has(a)) {
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

function buildGrokArgs(opts) {
  const args = ["-p", opts.prompt, "--output-format", "json"];
  if (opts.read) {
    // Best-effort read-only: plan mode reads and reasons but does not mutate.
    args.push("--permission-mode", "plan");
  } else {
    // Write-capable, fully non-blocking (no approval prompts headlessly).
    args.push("--always-approve");
  }
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

function renderResult(raw, opts) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON — hand back whatever grok printed.
    return raw.trimEnd() + "\n";
  }
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
  const opts = parseTaskArgs(argv);
  if (!opts.prompt) {
    process.stdout.write("No task text provided to grok-companion task.\n");
    process.exit(1);
  }
  const grokArgs = buildGrokArgs(opts);
  const cwd = opts.cwd || process.cwd();

  if (opts.background) {
    const logDir = join(tmpdir(), "grok-delegate");
    try {
      mkdirSync(logDir, { recursive: true });
    } catch {}
    // Avoid Date.now()/random for reproducibility quirks in some runtimes;
    // pid of the spawned process is the stable handle.
    const stamp = `${process.pid}`;
    const logFile = join(logDir, `grok-${stamp}.log`);
    const fd = openSync(logFile, "a");
    const child = spawn(bin, grokArgs, {
      cwd,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
    process.stdout.write(
      [
        "=== grok delegate (background) ===",
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

  // Foreground: stream nothing, capture stdout, render a clean summary.
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
      process.stdout.write(renderResult(out, opts));
      process.exit(0);
    }
    // Non-zero, or empty stdout: surface what we can. stderr from grok is noisy
    // (background-worker auth lines) even on success, so only show it on failure.
    process.stdout.write(
      [
        "=== grok delegate failed ===",
        `exit code: ${code}`,
        out.trim() ? `\nstdout:\n${out.trim()}` : "",
        err.trim() ? `\nstderr (tail):\n${err.trim().split("\n").slice(-8).join("\n")}` : "",
        "",
      ].join("\n") + "\n",
    );
    process.exit(code || 1);
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
  default:
    process.stdout.write(
      [
        "grok-companion — drive the headless Grok CLI",
        "",
        "Usage:",
        "  node grok-companion.mjs setup [--json]",
        "  node grok-companion.mjs task [routing flags] <task text>",
        "",
        "Routing flags for `task`:",
        "  --read              read-only (plan mode); default is write-capable",
        "  --background        spawn detached, return a log path",
        "  --effort <level>    low|medium|high|xhigh|max",
        "  --model <id>        grok model id",
        "  --cwd <path>        working directory (default: cwd)",
        "  --best-of-n <N>     run N ways, keep the best",
        "  --check             append a self-verification pass",
        "  --resume            continue the most recent grok session here",
        "  --worktree [name]   run inside a fresh git worktree",
        "",
      ].join("\n") + "\n",
    );
    process.exit(sub ? 1 : 0);
}
