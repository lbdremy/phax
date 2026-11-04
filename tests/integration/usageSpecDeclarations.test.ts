// The declarations of phax.usage.kdl during command-contracts, against a frozen copy of the file
// as it stood before the plan (tests/fixtures/usage/phax.usage.before-command-contracts.kdl).
// While commands move onto the runner the file mixes two KDL styles: today's walk writes child
// nodes, the runner's blocks properties. Read node by node through tests/helpers/usageKdl.ts,
// the committed file declares exactly what the frozen one declares, apart from the allowlist: the
// root's `--json-schema` and its exit-code documentation, and `--json` on each migrated command.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PARTIAL_GROUPS } from "../../src/cli/bridge.js";
import { fullName } from "../../src/cli/commandLibrary/contract/index.js";
import { phaxProgram } from "../../src/cli/definitions/program.js";
import { generateUsageSpec } from "../../scripts/generate-usage-spec.js";
import { usageDeclarations } from "../helpers/usageKdl.js";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const committed = readFileSync(join(repoRoot, "phax.usage.kdl"), "utf8");
const frozen = readFileSync(
  join(repoRoot, "tests/fixtures/usage/phax.usage.before-command-contracts.kdl"),
  "utf8",
);

/** The commands on the runner, in the program's order: the root inspection commands, `ls`,
 *  `artifact status` and the `plans` commands, each allowed the `--json` flag it gains with the
 *  library's help. */
const MIGRATED_COMMANDS: ReadonlyArray<string> = [
  "validate",
  "session-info",
  "path",
  "ls",
  "brief",
  "architecture",
  "report",
  "completions",
  "cost backfill",
  "security status",
  "skills install",
  "schema upgrade",
  "artifact status",
  "plans status",
  "plans overlap",
  "plans lint",
  "plans overview",
  "plans estimate",
  "records init",
  "records sync",
  "records status",
  "records list",
  "records explain",
];

/** The migrated commands that declared a `--json` of their own: the frozen file's `--json` is
 *  reworded, its help now the library's. */
const REWORDED_JSON: ReadonlyArray<string> = [
  "ls",
  "plans status",
  "plans overlap",
  "plans lint",
  "plans overview",
  "plans estimate",
];

/** The migrated commands whose long help now describes their versioned answer: `plans
 *  overview`'s document is a plan-overview with its $schema, and `ls`'s rows carry pullRequest. */
const REWORDED_LONG_HELP: ReadonlyArray<string> = ["ls", "plans overview"];

/** The groups the runner holds whole, nested ones by their full path: every group of phaxProgram
 *  whose outermost group the bridge does not hold in part. Each block is the runner's, whose
 *  header declares `subcommand_required` (`plans`). */
const WHOLE_GROUPS: ReadonlyArray<string> = [
  ...new Set(
    phaxProgram.commands.flatMap((command) => {
      const name = fullName(command);
      if (PARTIAL_GROUPS.includes(name[0] ?? "")) return [];
      return name.slice(0, -1).map((_, index) => name.slice(0, index + 1).join(" "));
    }),
  ),
];

/** What the committed file may declare beyond the frozen one: a path and a declaration's head
 *  (its kind and key). */
const ALLOWED_ADDITIONS: ReadonlyArray<readonly [string, string]> = [
  ["", "after_long_help "],
  ["", "flag --json-schema "],
  ...MIGRATED_COMMANDS.map((path) => [path, "flag --json "] as const),
  ...REWORDED_LONG_HELP.map((path) => [path, "long_help "] as const),
  ...WHOLE_GROUPS.map((path) => [path, "subcommand_required "] as const),
];

/** q-security-bare (refuse-bare): `security` and `security status` no longer declare their own
 *  `--verbose` and `--trace`; the program's options cover them anywhere in the call. Exactly
 *  these four declarations go. */
const DROPPED_SECURITY_FLAGS: ReadonlyArray<readonly [string, string]> = [
  ["security", "flag --verbose "],
  ["security", "flag --trace "],
  ["security status", "flag --verbose "],
  ["security status", "flag --trace "],
];

/** What the committed file may no longer declare as the frozen one did: each reworded
 *  `--json` and long help, and the four security flags q-security-bare drops. */
const ALLOWED_REWORDINGS: ReadonlyArray<readonly [string, string]> = [
  ...DROPPED_SECURITY_FLAGS,
  ...REWORDED_JSON.map((path) => [path, "flag --json "] as const),
  ...REWORDED_LONG_HELP.map((path) => [path, "long_help "] as const),
];

function difference(
  from: ReadonlyMap<string, ReadonlyArray<string>>,
  minus: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<readonly [string, string]> {
  const out: (readonly [string, string])[] = [];
  for (const [path, declarations] of from) {
    const other = minus.get(path) ?? [];
    for (const declaration of declarations) {
      if (!other.includes(declaration)) out.push([path, declaration]);
    }
  }
  return out;
}

describe("phax.usage.kdl's declarations against the frozen file", () => {
  const now = usageDeclarations(committed);
  const before = usageDeclarations(frozen);

  it("is the generator's output", () => {
    expect(committed).toBe(generateUsageSpec());
  });

  it("drops nothing the frozen file declares", () => {
    // Every command of the frozen file is read, nested ones included.
    expect(before.size).toBeGreaterThan(50);
    expect(before.get("artifact new spec")?.length).toBeGreaterThan(0);
    const dropped = difference(before, now).filter(
      ([path, declaration]) =>
        !ALLOWED_REWORDINGS.some(([where, head]) => where === path && declaration.startsWith(head)),
    );
    expect(dropped).toEqual([]);
  });

  it("rewords each allowlisted --json, which the file still declares", () => {
    for (const path of REWORDED_JSON) {
      const declared = (now.get(path) ?? []).filter((each) => each.startsWith("flag --json "));
      const frozenJson = (before.get(path) ?? []).filter((each) => each.startsWith("flag --json "));
      expect(declared, path).toHaveLength(1);
      expect(frozenJson, path).toHaveLength(1);
      expect(declared, path).not.toEqual(frozenJson);
    }
  });

  it("adds only the allowlisted declarations", () => {
    const added = difference(now, before).filter(
      ([path, declaration]) =>
        !ALLOWED_ADDITIONS.some(([where, head]) => where === path && declaration.startsWith(head)),
    );
    expect(added).toEqual([]);
  });

  it("adds each allowlisted root declaration", () => {
    const root = now.get("") ?? [];
    expect(root.some((each) => each.startsWith("after_long_help "))).toBe(true);
    expect(root.some((each) => each.startsWith("flag --json-schema "))).toBe(true);
  });

  it("allows --json on exactly the commands on the runner", () => {
    expect(phaxProgram.commands.map((command) => fullName(command).join(" "))).toEqual(
      MIGRATED_COMMANDS,
    );
  });

  it("declares subcommand_required on exactly the groups the runner holds whole", () => {
    const required = [...now]
      .filter(([, declarations]) =>
        declarations.some((each) => each.startsWith("subcommand_required ")),
      )
      .map(([path]) => path);
    const frozenRequired = [...before]
      .filter(([, declarations]) =>
        declarations.some((each) => each.startsWith("subcommand_required ")),
      )
      .map(([path]) => path);
    expect(required.filter((path) => !frozenRequired.includes(path)).toSorted()).toEqual(
      [...WHOLE_GROUPS].toSorted(),
    );
  });

  it("reads both styles to the same declarations", () => {
    const children = usageDeclarations(
      'cmd "x" {\n    help "Do x"\n    flag "--plan" {\n        arg "<path>"\n        required #true\n        help "A plan"\n    }\n    arg "<id>" {\n        help "An id"\n    }\n}\n',
    );
    const properties = usageDeclarations(
      'cmd x help="Do x" {\n    flag "--plan <path>" help="A plan" required=#true\n    arg <id> help="An id"\n}\n',
    );
    expect(properties.get("x")).toEqual(children.get("x"));
    expect(children.get("x")).toHaveLength(3);
  });
});
