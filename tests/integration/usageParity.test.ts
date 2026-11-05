import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { flagShapes, fullName } from "../../src/cli/commandLibrary/contract/index.js";
import { phaxProgram } from "../../src/cli/definitions/program.js";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const specPath = join(repoRoot, "phax.usage.kdl");

/** A command or group of the program, by name: its long flags without `--`, sorted. */
interface CommandNode {
  name: string;
  flags: string[];
  subcommands: CommandNode[];
}

// ── Documented allowlist: program flags intentionally absent from the Usage spec ──────────
//
// Any flag the program reads that the spec does not list must be named here with a
// justification. An unlisted mismatch is a bug — fix it in the definitions and regenerate.
//
// Key: full command path (e.g. "phax" for the root, "phax agent resolve" for a subcommand).
// Value: set of long flag names (without --) the program reads but the spec omits.
const PROGRAM_ONLY_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "phax",
    new Set([
      "version", // Answered by the runner before any command — standard CLI convention, not a spec field.
    ]),
  ],
]);

/** The flags of the root: the program's options, its usage flag and format, `--version` and
 *  `--json-schema`. */
function rootFlags(): string[] {
  const options = phaxProgram.options;
  const usage = phaxProgram.usage;
  return [
    ...(options === undefined ? [] : flagShapes(options.contract).map((flag) => flag.option)),
    ...(usage === undefined
      ? []
      : [usage.flag, ...(usage.format === undefined ? [] : [usage.format])]),
    "version",
    "json-schema",
  ].toSorted();
}

/** phaxProgram as a tree of commands and groups, each command with its declared flags, its stdin
 *  flag and `--json`; a command's retired options are never listed. */
function programTree(): CommandNode {
  const root: CommandNode = { name: "phax", flags: rootFlags(), subcommands: [] };
  for (const command of phaxProgram.commands) {
    let node = root;
    for (const word of fullName(command).slice(0, -1)) {
      let group = node.subcommands.find((each) => each.name === word);
      if (group === undefined) {
        group = { name: word, flags: [], subcommands: [] };
        node.subcommands.push(group);
      }
      node = group;
    }
    const flags = command.input.flags;
    const stdinFlag = command.input.stdin?.flag;
    node.subcommands.push({
      name: command.name,
      flags: [
        ...(flags === undefined ? [] : flagShapes(flags.contract).map((flag) => flag.option)),
        ...(stdinFlag === undefined ? [] : [stdinFlag]),
        "json",
      ].toSorted(),
      subcommands: [],
    });
  }
  return root;
}

// ── Usage CLI JSON types ─────────────────────────────────────────────────────────────────────

interface UsageFlag {
  long: string[];
}

interface UsageCmdJson {
  flags: UsageFlag[];
  subcommands: Record<string, UsageCmdJson>;
}

interface UsageJson {
  cmd: UsageCmdJson;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────

function loadUsageJson(): UsageJson {
  const result = spawnSync("usage", ["generate", "json", "-f", specPath], {
    encoding: "utf8",
    env: { ...process.env },
  });

  if (result.error !== undefined) {
    const isNotFound =
      (result.error as NodeJS.ErrnoException).code === "ENOENT" ||
      result.error.message.includes("ENOENT");
    if (isNotFound) {
      throw new Error(
        "The `usage` CLI is required for the parity gate but was not found on PATH.\n" +
          "Install it with: brew install usage\n" +
          "See https://usage.jdx.dev/cli/ for other install options.",
      );
    }
    throw result.error;
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`usage generate json failed (exit ${result.status}):\n${output}`);
  }

  return JSON.parse(result.stdout) as UsageJson;
}

function extractUsageNode(name: string, cmd: UsageCmdJson): CommandNode {
  return {
    name,
    flags: cmd.flags.flatMap((f) => f.long).toSorted(),
    subcommands: Object.entries(cmd.subcommands ?? {}).map(([n, sub]) => extractUsageNode(n, sub)),
  };
}

// ── Flatten tree to path → {flags, childNames} for bidirectional comparison ──────────────────

interface FlatNode {
  flags: Set<string>;
  childNames: Set<string>;
}

function flattenTree(root: CommandNode, path: string, out: Map<string, FlatNode>): void {
  out.set(path, {
    flags: new Set(root.flags),
    childNames: new Set(root.subcommands.map((s) => s.name)),
  });
  for (const sub of root.subcommands) {
    flattenTree(sub, `${path} ${sub.name}`, out);
  }
}

// ── Parity suite ─────────────────────────────────────────────────────────────────────────────
//
// This gate is a name-level drift guard over the generated spec, not an independent
// hand-authored contract.  phax.usage.kdl is the runner's usage spec of phaxProgram, the
// program this test reads.  When the spec is up to date (i.e. `pnpm gen:usage-spec` was run
// after any CLI change) these tests trivially pass.  When the committed spec is stale they
// catch the mismatch at the command/flag-name level and tell the author to regenerate.  The
// byte-equality drift gate (usageSpecDrift.test.ts) is the primary freshness guard; this gate
// provides a second, human-readable signal and enforces the PROGRAM_ONLY_FLAGS allowlist.
//
// Both trees are loaded once at describe level. If the `usage` CLI is not installed,
// loadUsageJson() throws an actionable error here and all tests in the suite fail with it.
// This is intentional: `usage` is a declared required command for this project.

describe("program/Usage parity gate", () => {
  const usageJson = loadUsageJson();
  const usageRoot = extractUsageNode("phax", usageJson.cmd);
  const programRoot = programTree();

  const usageMap = new Map<string, FlatNode>();
  const programMap = new Map<string, FlatNode>();
  flattenTree(usageRoot, "phax", usageMap);
  flattenTree(programRoot, "phax", programMap);

  it("every program command path exists in the Usage spec", () => {
    const missing = [...programMap.keys()].filter((path) => !usageMap.has(path));
    expect(
      missing,
      `Program commands absent from the Usage spec — run pnpm gen:usage-spec:\n${missing.map((p) => `  ${p}`).join("\n")}`,
    ).toEqual([]);
  });

  it("every Usage spec command path exists in the program", () => {
    const missing = [...usageMap.keys()].filter((path) => !programMap.has(path));
    expect(
      missing,
      `Usage spec commands absent from the program — run pnpm gen:usage-spec:\n${missing.map((p) => `  ${p}`).join("\n")}`,
    ).toEqual([]);
  });

  it("every program flag is in the Usage spec or the documented allowlist", () => {
    const violations: string[] = [];
    for (const [path, { flags }] of programMap) {
      const usageFlags = usageMap.get(path)?.flags ?? new Set<string>();
      const allowlist = PROGRAM_ONLY_FLAGS.get(path) ?? new Set<string>();
      for (const flag of [...flags].toSorted()) {
        if (!usageFlags.has(flag) && !allowlist.has(flag)) {
          violations.push(`  ${path}: --${flag}`);
        }
      }
    }
    expect(
      violations,
      "Program flags missing from the Usage spec — run pnpm gen:usage-spec,\nor add to PROGRAM_ONLY_FLAGS with a written justification:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  it("every Usage spec flag is in the program", () => {
    const violations: string[] = [];
    for (const [path, { flags }] of usageMap) {
      const programFlags = programMap.get(path)?.flags ?? new Set<string>();
      for (const flag of [...flags].toSorted()) {
        if (!programFlags.has(flag)) {
          violations.push(`  ${path}: --${flag}`);
        }
      }
    }
    expect(
      violations,
      "Usage spec flags absent from the program — run pnpm gen:usage-spec:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  it("lists the retired options in neither the program's tree nor the spec", () => {
    const resume = phaxProgram.commands.find((command) => fullName(command).join(" ") === "resume");
    expect(Object.keys(resume?.retiredOptions ?? {})).toEqual(["skip-oracle"]);
    expect(programMap.get("phax resume")?.flags.has("skip-oracle")).toBe(false);
    expect(usageMap.get("phax resume")?.flags.has("skip-oracle")).toBe(false);
  });
});
