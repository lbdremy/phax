import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Recorded Vibe 3.0.3 output, from the 2026-10-27 probe. Each headless turn
// writes an `export.json` into its `--output-dir`; its usage and cost count
// that turn only, and its keys beyond the ones phax reads (`limits`, `config`,
// `steps`, `journal_dir`, the timestamps) are carried here as Vibe wrote them.

/** The session both probe turns ran in: the second resumed the first. */
export const VIBE3_SESSION_ID = "b8e0e3a1-9ad8-2100-46e7-4a199256f640";

interface Vibe3Export {
  readonly schema_version: 1;
  readonly session_id: string;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cached_input_tokens: number;
    readonly total_tokens: number;
  };
  readonly cost_usd: number;
  readonly outcome: string;
  readonly exit_code: number;
  readonly vibe_version: string;
  readonly [extra: string]: unknown;
}

function vibe3Export(
  usage: { readonly input: number; readonly cached: number; readonly output: number },
  costUsd: number,
  startedAt: string,
): Vibe3Export {
  return {
    schema_version: 1,
    session_id: VIBE3_SESSION_ID,
    usage: {
      input_tokens: usage.input,
      output_tokens: usage.output,
      cached_input_tokens: usage.cached,
      total_tokens: usage.input + usage.output,
    },
    cost_usd: costUsd,
    outcome: "finished",
    exit_code: 0,
    vibe_version: "3.0.3",
    started_at: startedAt,
    limits: { max_turns: null, max_price: null },
    config: { active_model: "mistral-medium-3.5" },
    steps: 2,
    journal_dir: "journal",
  };
}

/** The probe's first turn: 10987 input tokens, 3200 of them cached, 3 output, at $0.016503. */
export const VIBE3_EXPORT_SHORT = vibe3Export(
  { input: 10987, cached: 3200, output: 3 },
  0.016503,
  "2026-10-27T09:14:02.118Z",
);

/** The probe's second turn, a resume of the first: 34588 input, 9600 cached, 288 output, at $0.054042. */
export const VIBE3_EXPORT_LONG = vibe3Export(
  { input: 34588, cached: 9600, output: 288 },
  0.054042,
  "2026-10-27T09:14:31.902Z",
);

/** An export as Vibe writes it to `export.json`. */
export function vibe3ExportText(exported: Vibe3Export): string {
  return `${JSON.stringify(exported, null, 2)}\n`;
}

// ── The stream a headless turn prints (`vibe -p --output streaming`) ───────

/** When the probe's first turn answered: the `createdAt` of its assistant message. */
const VIBE3_PONG_CREATED_AT = 1793116136395;

interface Vibe3StreamEntry {
  readonly type: "message" | "effect" | "callback";
  readonly sessionId: string;
  readonly createdAt: number;
  readonly [extra: string]: unknown;
}

function vibe3Message(
  role: "user" | "assistant",
  blocks: readonly unknown[],
  createdAt: number,
): Vibe3StreamEntry {
  return {
    type: "message",
    role,
    content: blocks,
    messageId: `msg-${createdAt}`,
    sessionId: VIBE3_SESSION_ID,
    createdAt,
  };
}

/** A text block of a message's content. */
export const vibe3Text = (text: string): { type: "text"; text: string } => ({
  type: "text",
  text,
});

/** An assistant message whose content is `blocks`. */
export function vibe3Assistant(
  blocks: readonly unknown[],
  createdAt = VIBE3_PONG_CREATED_AT,
): Vibe3StreamEntry {
  return vibe3Message("assistant", blocks, createdAt);
}

/** A user message with one text block. */
export function vibe3User(text: string, createdAt: number): Vibe3StreamEntry {
  return vibe3Message("user", [vibe3Text(text)], createdAt);
}

/** An effect entry, as Vibe interleaves them with messages. */
export function vibe3Effect(createdAt: number): Vibe3StreamEntry {
  return { type: "effect", name: "session_started", sessionId: VIBE3_SESSION_ID, createdAt };
}

/** A callback entry, as Vibe interleaves them with messages. */
export function vibe3Callback(createdAt: number): Vibe3StreamEntry {
  return { type: "callback", name: "on_user_message", sessionId: VIBE3_SESSION_ID, createdAt };
}

/** Entries as the stream prints them: one JSON object per line. */
export function vibe3StreamText(entries: readonly Vibe3StreamEntry[]): string {
  return entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
}

/** The probe's first turn: effect and callback entries, then the assistant's `PONG`. */
export const VIBE3_PONG_STREAM: readonly Vibe3StreamEntry[] = [
  vibe3Effect(1793116135001),
  vibe3Callback(1793116135200),
  vibe3User("Reply with PONG", 1793116135400),
  vibe3Effect(1793116135900),
  vibe3Assistant([vibe3Text("PONG")]),
  vibe3Callback(1793116136400),
];

/** The probe's second turn, a resume of the first: it starts after the first ended. */
export const VIBE3_RESUME_STREAM: readonly Vibe3StreamEntry[] = [
  vibe3Effect(1793116166001),
  vibe3User("Now reply with DONE", 1793116166200),
  vibe3Assistant([vibe3Text("DO"), vibe3Text("NE")], 1793116168000),
];

// ── A fake `vibe` executable ────────────────────────────────────────────────

interface FakeVibeOptions {
  /** What `--version` prints; default `vibe 3.0.3`. */
  readonly version?: string;
  /** The stream `-p` prints; default the probe's `PONG` turn. */
  readonly stream?: string;
  /** The `export.json` written into `--output-dir`; none when undefined. */
  readonly exportText?: string | undefined;
  /** The exit code of a `-p` turn; default 0. */
  readonly exitCode?: number;
}

interface FakeVibe {
  readonly executable: string;
  /** One line per invocation, its arguments joined by a space, in order. */
  invocations(): readonly string[];
  /** How many invocations were `--version` reads, and how many were `-p` turns. */
  versionReads(): number;
  turns(): number;
}

/**
 * Write a `vibe` stand-in into `dir`. `--version` prints `version`; `-p`
 * prints `stream`, then writes `exportText` as `export.json` into its
 * `--output-dir` (nothing when `exportText` is undefined) and exits with
 * `exitCode`. Every invocation is logged. The executable's path is its own, so
 * the adapter's once-per-executable version read starts fresh in every test.
 */
export function writeFakeVibe(dir: string, options: FakeVibeOptions = {}): FakeVibe {
  mkdirSync(dir, { recursive: true });
  const executable = join(dir, "vibe");
  const log = join(dir, "invocations.log");
  writeFileSync(join(dir, "version.txt"), `${options.version ?? "vibe 3.0.3"}\n`);
  writeFileSync(join(dir, "stream.jsonl"), options.stream ?? vibe3StreamText(VIBE3_PONG_STREAM));
  if (options.exportText !== undefined) writeFileSync(join(dir, "export.json"), options.exportText);
  writeFileSync(
    executable,
    [
      "#!/bin/sh",
      'here="$(dirname "$0")"',
      'echo "$*" >> "$here/invocations.log"',
      'if [ "$1" = "--version" ]; then cat "$here/version.txt"; exit 0; fi',
      'out=""',
      "while [ $# -gt 0 ]; do",
      '  if [ "$1" = "--output-dir" ]; then out="$2"; fi',
      "  shift",
      "done",
      'cat "$here/stream.jsonl"',
      'if [ -n "$out" ] && [ -f "$here/export.json" ]; then mkdir -p "$out"; cp "$here/export.json" "$out/export.json"; fi',
      `exit ${options.exitCode ?? 0}`,
      "",
    ].join("\n"),
  );
  chmodSync(executable, 0o755);
  const invocations = (): readonly string[] =>
    existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return {
    executable,
    invocations,
    versionReads: () => invocations().filter((line) => line === "--version").length,
    turns: () => invocations().filter((line) => line.startsWith("-p ")).length,
  };
}
