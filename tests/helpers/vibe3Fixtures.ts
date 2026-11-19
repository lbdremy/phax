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

// ── The config two Vibe 3.1.3 turns ran with ───────────────────────────────

// Recorded from the operator's real e2e on 2026-11-19: two turns in one
// VIBE_HOME, both started with `--model mistral-medium-3.5 --thinking high`.
// Trimmed to `vibe_version` and the config keys the model check reads
// (`active_model`, `catalog_model_aliases`, and each `models` entry's `name`,
// `thinking` and `provider`).

/** The first turn, before Vibe had cached its model catalog: the alias phax passed, no alias groups. */
export const VIBE313_CONFIG_BEFORE_CATALOG = {
  vibe_version: "3.1.3",
  config: {
    active_model: "mistral-medium-3.5",
    catalog_model_aliases: {},
    models: {
      "mistral-large-4-0": { name: "mistral-large-4-0", thinking: "high", provider: "mistral" },
      "mistral-medium-3.5": {
        name: "mistral-vibe-cli-latest",
        thinking: "high",
        provider: "mistral",
      },
    },
  },
} as const;

/**
 * A later turn, after Vibe wrote `model_catalog_cache.json` into its home: the
 * alias phax passed resolved to its canonical name, and `models` keyed by
 * canonical names. A fresh session and a resume both read like this.
 */
export const VIBE313_CONFIG_AFTER_CATALOG = {
  vibe_version: "3.1.3",
  config: {
    active_model: "mistral-medium-latest",
    catalog_model_aliases: {
      "mistral-large-4-0": ["mistral-large-4-0-3", "mistral-large-4"],
      "mistral-medium-latest": ["mistral-medium", "mistral-medium-3.5", "mistral-vibe-cli-latest"],
      "zai-glm-5-3": ["glm-5-3", "zai-glm-5", "zai-glm-latest"],
    },
    models: {
      "mistral-large-4-0": { name: "mistral-large-4-0", thinking: "high", provider: "mistral" },
      "mistral-medium-latest": {
        name: "mistral-medium-latest",
        thinking: "high",
        provider: "mistral",
      },
      "zai-glm-5-3": { name: "zai-glm-5-3", thinking: "high", provider: "mistral" },
      "zai-glm-5-3-flash": { name: "zai-glm-5-3-flash", thinking: "high", provider: "mistral" },
    },
  },
} as const;

/** The alias groups of Vibe 3.1.3's cached catalog, as the later turn above read them. */
export const VIBE313_CATALOG_ALIASES = VIBE313_CONFIG_AFTER_CATALOG.config.catalog_model_aliases;

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
  /** What `--version` prints; default `vibe 3.1.3`. */
  readonly version?: string;
  /** The stream `-p` prints; default the probe's `PONG` turn. */
  readonly stream?: string;
  /** The `export.json` written into `--output-dir`; none when undefined. */
  readonly exportText?: string | undefined;
  /** The exit code of a `-p` turn; default 0. */
  readonly exitCode?: number;
  /** What a `-p` turn writes to stderr; nothing by default. */
  readonly stderr?: string;
  /**
   * Top-level keys laid over the export's `config` after the fake has resolved
   * it (flags, variables and a resumed session's restored model and level
   * included), as an agent profile would: `{ bypass_tool_permissions: true }` is
   * a turn that ran under auto-approve whatever phax set.
   */
  readonly configOverride?: Readonly<Record<string, unknown>>;
  /**
   * The alias groups (canonical name → aliases) of the model catalog Vibe
   * caches in its home after its first turn there. Given, the first turn that
   * writes an export reads `catalog_model_aliases: {}` and caches the catalog,
   * and every later turn canonicalises as Vibe 3.1.3 does; none by default (no
   * `catalog_model_aliases` at all).
   */
  readonly catalogAliases?: Readonly<Record<string, readonly string[]>>;
  /**
   * The files the nth `-p` turn writes in its cwd before it answers, one list
   * per turn in order, as `{ path, content }` relative to the cwd; none by default.
   */
  readonly turnWrites?: readonly (readonly { readonly path: string; readonly content: string }[])[];
}

/** One `-p` turn as the fake saw it: its arguments (the prompt among them) and whole environment. */
interface FakeVibeTrace {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

interface FakeVibe {
  readonly executable: string;
  /** One line per invocation, its arguments joined by a space, in order. */
  invocations(): readonly string[];
  /** How many invocations were `--version` reads, and how many were `-p` turns. */
  versionReads(): number;
  turns(): number;
  /** The `VIBE_*` environment of the last `-p` turn; empty before any turn. */
  turnEnv(): Readonly<Record<string, string>>;
  /** Every `-p` turn's arguments and environment, in order. */
  traces(): readonly FakeVibeTrace[];
}

// The fake, a Node script run by the test's own node. Its export's `config` is
// the export template's own `config` with what the turn's flags and VIBE_*
// variables set laid over it, as Vibe resolves them: the values phax sets, read
// back. A turn that sets none (an unsafe one) keeps the template's config.
//
// It mirrors Vibe 3.1.3 as probed on 2026-11-18:
// - On a new session (`-p` without `--resume`), `--model M` sets
//   `config.active_model` to M, and `--thinking L` sets
//   `config.models[<active_model>]` to the template's entry for that alias (if
//   any) with `alias` and `thinking: L` laid over it. `models` is an object
//   keyed by alias, and the template's other entries stay.
// - A turn that passed either flag remembers its `active_model` and that
//   `models` entry in `sessions.json` beside the fake, keyed by the export
//   template's `session_id`. A resumed turn (`--resume S`) lays the entry
//   remembered for S back onto its config: a resume keeps the model and level.
// - A resume given `--model` or `--thinking` exits 1 with
//   `Error: --model only applies to a new session` on stderr (naming
//   `--thinking` when only that was given), prints no stream and writes no
//   export. Its invocation and trace are still recorded.
// - With `catalogAliases`, the first turn writing an export reads
//   `catalog_model_aliases: {}` and leaves `model-catalog-cache.json` beside the
//   fake (Vibe's `model_catalog_cache.json` in its home). Every later turn, new
//   or resumed, reads those groups as `catalog_model_aliases`, its
//   `active_model` becomes the canonical name of the group listing it, and its
//   `models` are keyed by canonical names, each entry's `name` and `alias` that
//   name (a level set on the alias stays on the canonical entry).
// - `configOverride` is laid over everything, last.
const FAKE_VIBE_SCRIPT = `
const { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = process.getBuiltinModule("node:fs");
const { dirname, join } = process.getBuiltinModule("node:path");
const here = dirname(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(join(here, "invocations.log"), args.join(" ") + "\\n");
if (args[0] === "--version") {
  process.stdout.write(readFileSync(join(here, "version.txt"), "utf8"));
  process.exit(0);
}
const vibeEnv = Object.entries(process.env).filter(([key]) => key.startsWith("VIBE_"));
writeFileSync(join(here, "turn-env.txt"), vibeEnv.map(([key, value]) => key + "=" + value + "\\n").join(""));
appendFileSync(join(here, "trace.jsonl"), JSON.stringify({ argv: args, env: process.env }) + "\\n");
const valueOf = (flag) => { const at = args.indexOf(flag); return at === -1 ? undefined : args[at + 1]; };
const resumeId = valueOf("--resume");
const modelFlag = valueOf("--model");
const thinkingFlag = valueOf("--thinking");
if (resumeId !== undefined && (modelFlag !== undefined || thinkingFlag !== undefined)) {
  const flag = modelFlag !== undefined ? "--model" : "--thinking";
  process.stderr.write("Error: " + flag + " only applies to a new session\\n");
  process.exit(1);
}
const turnNumber = readFileSync(join(here, "trace.jsonl"), "utf8").split("\\n").filter(Boolean).length;
const writesFile = join(here, "turn-writes.json");
if (existsSync(writesFile)) {
  for (const write of JSON.parse(readFileSync(writesFile, "utf8"))[turnNumber - 1] ?? []) {
    const target = join(process.cwd(), write.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, write.content);
  }
}
const out = valueOf("--output-dir");
process.stdout.write(readFileSync(join(here, "stream.jsonl"), "utf8"));
if (existsSync(join(here, "stderr.txt"))) process.stderr.write(readFileSync(join(here, "stderr.txt"), "utf8"));
const template = join(here, "export.json");
if (out !== undefined && existsSync(template)) {
  mkdirSync(out, { recursive: true });
  const exported = JSON.parse(readFileSync(template, "utf8"));
  const enabled = args.flatMap((arg, at) => (arg === "--enabled-tools" ? [args[at + 1]] : []));
  const env = process.env;
  const resolved = { ...(exported.config ?? {}) };
  if (env.VIBE_BYPASS_TOOL_PERMISSIONS !== undefined) {
    resolved.bypass_tool_permissions = env.VIBE_BYPASS_TOOL_PERMISSIONS === "true";
  }
  if (env.VIBE_OUTSIDE_WORKDIR !== undefined) resolved.outside_workdir = env.VIBE_OUTSIDE_WORKDIR;
  if (env.VIBE_TOOLS !== undefined) resolved.tools = JSON.parse(env.VIBE_TOOLS);
  if (enabled.length > 0) resolved.enabled_tools = enabled;
  if (env.VIBE_ENABLE_MCP !== undefined) resolved.enable_mcp = env.VIBE_ENABLE_MCP === "true";
  if (env.VIBE_ENABLE_CONNECTORS !== undefined) {
    resolved.enable_connectors = env.VIBE_ENABLE_CONNECTORS === "true";
  }
  const isPlain = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  const remembered = join(here, "sessions.json");
  const sessions = existsSync(remembered) ? JSON.parse(readFileSync(remembered, "utf8")) : {};
  if (resumeId === undefined) {
    if (modelFlag !== undefined) resolved.active_model = modelFlag;
    if (thinkingFlag !== undefined) {
      const active = resolved.active_model;
      const models = isPlain(resolved.models) ? { ...resolved.models } : {};
      models[active] = { ...(isPlain(models[active]) ? models[active] : {}), alias: active, thinking: thinkingFlag };
      resolved.models = models;
    }
    if (modelFlag !== undefined || thinkingFlag !== undefined) {
      const active = resolved.active_model;
      const entry = isPlain(resolved.models) ? resolved.models[active] : undefined;
      sessions[exported.session_id] = { active_model: active, ...(entry === undefined ? {} : { entry }) };
      writeFileSync(remembered, JSON.stringify(sessions));
    }
  } else if (sessions[resumeId] !== undefined) {
    const kept = sessions[resumeId];
    resolved.active_model = kept.active_model;
    if (kept.entry !== undefined) {
      resolved.models = { ...(isPlain(resolved.models) ? resolved.models : {}), [kept.active_model]: kept.entry };
    }
  }
  const catalog = join(here, "catalog-aliases.json");
  const catalogCache = join(here, "model-catalog-cache.json");
  if (existsSync(catalogCache)) {
    const groups = JSON.parse(readFileSync(catalogCache, "utf8"));
    const canonicalOf = (name) =>
      Object.keys(groups).find((canonical) => canonical === name || groups[canonical].includes(name)) ?? name;
    resolved.catalog_model_aliases = groups;
    if (typeof resolved.active_model === "string") resolved.active_model = canonicalOf(resolved.active_model);
    if (isPlain(resolved.models)) {
      const canonicalModels = {};
      for (const [name, entry] of Object.entries(resolved.models)) {
        const canonical = canonicalOf(name);
        const kept = canonicalModels[canonical];
        canonicalModels[canonical] = isPlain(entry)
          ? { ...(isPlain(kept) ? kept : {}), ...entry, name: canonical, alias: canonical }
          : entry;
      }
      resolved.models = canonicalModels;
    }
  } else if (existsSync(catalog)) {
    resolved.catalog_model_aliases = {};
    writeFileSync(catalogCache, readFileSync(catalog, "utf8"));
  }
  const override = join(here, "config-override.json");
  const config = existsSync(override)
    ? { ...resolved, ...JSON.parse(readFileSync(override, "utf8")) }
    : resolved;
  writeFileSync(join(out, "export.json"), JSON.stringify({ ...exported, config }, null, 2) + "\\n");
}
process.exitCode = Number(readFileSync(join(here, "exit-code.txt"), "utf8"));
`;

/**
 * Write a `vibe` stand-in into `dir`. `--version` prints `version`; `-p`
 * prints `stream` and writes `stderr`, then writes `exportText` as `export.json` into its
 * `--output-dir`, its `config` resolved from the turn's flags and variables
 * (nothing when `exportText` is undefined), and exits with `exitCode`. Every
 * invocation is logged, and a turn's `VIBE_*` environment is kept. The
 * executable's path is its own, so the adapter's once-per-executable version
 * read starts fresh in every test.
 */
export function writeFakeVibe(dir: string, options: FakeVibeOptions = {}): FakeVibe {
  mkdirSync(dir, { recursive: true });
  const executable = join(dir, "vibe");
  const log = join(dir, "invocations.log");
  writeFileSync(join(dir, "version.txt"), `${options.version ?? "vibe 3.1.3"}\n`);
  writeFileSync(join(dir, "stream.jsonl"), options.stream ?? vibe3StreamText(VIBE3_PONG_STREAM));
  writeFileSync(join(dir, "exit-code.txt"), String(options.exitCode ?? 0));
  if (options.exportText !== undefined) writeFileSync(join(dir, "export.json"), options.exportText);
  if (options.stderr !== undefined) writeFileSync(join(dir, "stderr.txt"), options.stderr);
  if (options.configOverride !== undefined) {
    writeFileSync(join(dir, "config-override.json"), JSON.stringify(options.configOverride));
  }
  if (options.catalogAliases !== undefined) {
    writeFileSync(join(dir, "catalog-aliases.json"), JSON.stringify(options.catalogAliases));
  }
  if (options.turnWrites !== undefined) {
    writeFileSync(join(dir, "turn-writes.json"), JSON.stringify(options.turnWrites));
  }
  writeFileSync(executable, `#!${process.execPath}\n${FAKE_VIBE_SCRIPT}`);
  chmodSync(executable, 0o755);
  const invocations = (): readonly string[] =>
    existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return {
    executable,
    invocations,
    versionReads: () => invocations().filter((line) => line === "--version").length,
    turns: () => invocations().filter((line) => line.startsWith("-p ")).length,
    traces: () => {
      const file = join(dir, "trace.jsonl");
      if (!existsSync(file)) return [];
      return readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as FakeVibeTrace);
    },
    turnEnv: () => {
      const file = join(dir, "turn-env.txt");
      if (!existsSync(file)) return {};
      return Object.fromEntries(
        readFileSync(file, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const at = line.indexOf("=");
            return [line.slice(0, at), line.slice(at + 1)];
          }),
      );
    },
  };
}
