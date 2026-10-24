import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Fake `claude` and `codex` executables for tests that drive the real
 * backend. Each is a Node script in a temporary bin directory that:
 * - appends `{ executable, argv, cwd }` as one JSON line to the file named by
 *   `PHAX_FAKE_CLI_LOG`;
 * - reads its stdin (the prompt) to the end;
 * - follows the JSON script file named by `PHAX_FAKE_CLI_SCRIPT`: optionally
 *   writes a file in its cwd, then prints a canned stream (Claude's
 *   stream-json init, assistant message and result; codex's `--json` thread,
 *   item and turn events) carrying the script's final text and session id,
 *   or reports a rate limit and exits 1;
 * - appends the lines it printed to its session store under `$HOME`, as the
 *   real CLI keeps its transcript: Claude to
 *   `.claude/projects/<slug of its cwd>/<id>.jsonl`, codex to
 *   `.codex/sessions/<UTC YYYY>/<MM>/<DD>/rollout-<timestamp>-<id>.jsonl`. A
 *   resume of the same id appends to the same file.
 *
 * phax spawns `claude` by name, so a test prepends `binDir` to PATH (see
 * `env`); codex runs from its provider entry's `executable`, `codexPath`.
 * `env` also points HOME at a temporary directory, so no test reads ~/.phax
 * and the stores land under the test's own HOME.
 */
interface FakeCliScript {
  readonly sessionId: string;
  readonly finalText: string;
  /** A file the CLI writes, relative to its cwd, before it answers. */
  readonly writeFile?: { readonly path: string; readonly content: string };
  /** Report a rate limit instead of answering. */
  readonly rateLimit?: boolean;
  /** False keeps the session out of the store, as a provider that lost it would. Default true. */
  readonly keepStore?: boolean;
}

interface FakeCliInvocation {
  readonly executable: "claude" | "codex";
  readonly argv: readonly string[];
  readonly cwd: string;
}

export interface FakeProviderCli {
  readonly binDir: string;
  readonly claudePath: string;
  readonly codexPath: string;
  /** The variables to merge over `process.env`: PATH, HOME and the two files. */
  readonly env: Readonly<Record<string, string>>;
  setScript(script: FakeCliScript): void;
  invocations(): readonly FakeCliInvocation[];
}

const SHARED = `
const fs = require("node:fs");
const path = require("node:path");
const executable = path.basename(process.argv[1]);
fs.appendFileSync(
  process.env.PHAX_FAKE_CLI_LOG,
  JSON.stringify({ executable, argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n",
);
const script = JSON.parse(fs.readFileSync(process.env.PHAX_FAKE_CLI_SCRIPT, "utf8"));
const printed = [];
const print = (event) => {
  const line = JSON.stringify(event);
  printed.push(line);
  process.stdout.write(line + "\\n");
};
// Append what was printed to the session's store file, chosen by \`storeFile\`
// once the process exits, whichever way it exits.
function keepInStore(storeFile) {
  process.on("exit", () => {
    if (script.keepStore === false || printed.length === 0) return;
    const file = storeFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, printed.join("\\n") + "\\n");
  });
}
function answer(stream) {
  if (script.writeFile) {
    const target = path.join(process.cwd(), script.writeFile.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, script.writeFile.content);
  }
  stream();
}
let stdin = "";
process.stdin.on("data", (chunk) => { stdin += chunk; });
`;

const CLAUDE = `${SHARED}
keepInStore(() =>
  path.join(
    process.env.HOME,
    ".claude",
    "projects",
    process.cwd().replace(/[^A-Za-z0-9]/g, "-"),
    script.sessionId + ".jsonl",
  ),
);
process.stdin.on("end", () => answer(() => {
  const id = script.sessionId;
  print({ type: "system", subtype: "init", session_id: id, model: "claude-sonnet-5-5", tools: [] });
  if (script.rateLimit) {
    print({ type: "result", subtype: "error", is_error: true, result: "API Error: rate limit exceeded", session_id: id });
    process.exit(1);
  }
  print({
    type: "assistant",
    session_id: id,
    message: {
      id: "msg_01",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text: script.finalText }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });
  print({ type: "result", subtype: "success", is_error: false, result: script.finalText, session_id: id });
}));
`;

const CODEX = `${SHARED}
// The session's existing rollout, so a resume appends to it; else a new one
// filed under today's UTC date.
function rolloutFile() {
  const sessions = path.join(process.env.HOME, ".codex", "sessions");
  const suffix = "-" + script.sessionId + ".jsonl";
  const found = fs.existsSync(sessions)
    ? fs.readdirSync(sessions, { recursive: true }).find((name) => String(name).endsWith(suffix))
    : undefined;
  if (found !== undefined) return path.join(sessions, String(found));
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const day = [now.getUTCFullYear(), pad(now.getUTCMonth() + 1), pad(now.getUTCDate())];
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, "-");
  return path.join(sessions, ...day.map(String), "rollout-" + stamp + suffix);
}
keepInStore(rolloutFile);
process.stdin.on("end", () => answer(() => {
  if (script.rateLimit) {
    print({ type: "error", message: "rate limit exceeded" });
    process.exit(1);
  }
  print({ type: "thread.started", thread_id: script.sessionId });
  print({ type: "turn.started" });
  print({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: script.finalText } });
  print({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } });
}));
`;

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, `#!${process.execPath}\n${body}`);
  chmodSync(path, 0o755);
}

/** Install the fake CLIs under `root` (a fresh temporary directory). */
export function makeFakeProviderCli(root: string): FakeProviderCli {
  const binDir = join(root, "bin");
  const home = join(root, "home");
  const logPath = join(root, "fake-cli.log.jsonl");
  const scriptPath = join(root, "fake-cli.script.json");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  const claudePath = join(binDir, "claude");
  const codexPath = join(binDir, "codex");
  writeExecutable(claudePath, CLAUDE);
  writeExecutable(codexPath, CODEX);
  return {
    binDir,
    claudePath,
    codexPath,
    env: {
      PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
      HOME: home,
      PHAX_FAKE_CLI_LOG: logPath,
      PHAX_FAKE_CLI_SCRIPT: scriptPath,
    },
    setScript: (script) => writeFileSync(scriptPath, JSON.stringify(script)),
    invocations: () =>
      existsSync(logPath)
        ? readFileSync(logPath, "utf8")
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line) as FakeCliInvocation)
        : [],
  };
}
