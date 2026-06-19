import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProgram } from "../../src/cli/program.js";
import { extractCommandTree, type CommandNode } from "../../src/cli/introspect.js";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const specPath = join(repoRoot, "phax.usage.kdl");

// ── Documented allowlist: Commander flags intentionally absent from the Usage spec ──────────
//
// Any Commander flag absent from the spec must be listed here with a justification.
// An unlisted mismatch is a bug — fix it in phax.usage.kdl or program.ts.
//
// Key: full command path (e.g. "phax" for the root, "phax agent resolve" for a subcommand).
// Value: set of long flag names (without --) that Commander has but the spec intentionally omits.
const COMMANDER_ONLY_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "phax",
    new Set([
      "version", //      Commander built-in added by .version() — standard CLI convention, not a spec field.
      "usage", //        Prints the spec itself; including it in the spec would be circular.
      "usage-format", // Companion to --usage; same self-referential rationale.
    ]),
  ],
]);

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
          "Install it with: brew install jdx/tap/usage\n" +
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
// Both trees are loaded once at describe level. If the `usage` CLI is not installed,
// loadUsageJson() throws an actionable error here and all tests in the suite fail with it.
// This is intentional: `usage` is a declared required command for this project.

describe("Commander/Usage parity gate", () => {
  const usageJson = loadUsageJson();
  const usageRoot = extractUsageNode("phax", usageJson.cmd);
  const commanderRoot = extractCommandTree(buildProgram());

  const usageMap = new Map<string, FlatNode>();
  const commanderMap = new Map<string, FlatNode>();
  flattenTree(usageRoot, "phax", usageMap);
  flattenTree(commanderRoot, "phax", commanderMap);

  it("every Commander command path exists in the Usage spec", () => {
    const missing = [...commanderMap.keys()].filter((path) => !usageMap.has(path));
    expect(
      missing,
      `Commander commands absent from the Usage spec — add them to phax.usage.kdl:\n${missing.map((p) => `  ${p}`).join("\n")}`,
    ).toEqual([]);
  });

  it("every Usage spec command path exists in Commander", () => {
    const missing = [...usageMap.keys()].filter((path) => !commanderMap.has(path));
    expect(
      missing,
      `Usage spec commands absent from Commander — add them to program.ts or remove from phax.usage.kdl:\n${missing.map((p) => `  ${p}`).join("\n")}`,
    ).toEqual([]);
  });

  it("every Commander flag is in the Usage spec or the documented allowlist", () => {
    const violations: string[] = [];
    for (const [path, { flags }] of commanderMap) {
      const usageFlags = usageMap.get(path)?.flags ?? new Set<string>();
      const allowlist = COMMANDER_ONLY_FLAGS.get(path) ?? new Set<string>();
      for (const flag of [...flags].toSorted()) {
        if (!usageFlags.has(flag) && !allowlist.has(flag)) {
          violations.push(`  ${path}: --${flag}`);
        }
      }
    }
    expect(
      violations,
      "Commander flags missing from the Usage spec — add them to phax.usage.kdl,\nor add to COMMANDER_ONLY_FLAGS with a written justification:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  it("every Usage spec flag is in Commander", () => {
    const violations: string[] = [];
    for (const [path, { flags }] of usageMap) {
      const commanderFlags = commanderMap.get(path)?.flags ?? new Set<string>();
      for (const flag of [...flags].toSorted()) {
        if (!commanderFlags.has(flag)) {
          violations.push(`  ${path}: --${flag}`);
        }
      }
    }
    expect(
      violations,
      "Usage spec flags absent from Commander — remove them from phax.usage.kdl\nor add the missing options to program.ts:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });
});
