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

/** The commands on the runner: phase-05 adds `artifact status`, `plans overview`, `plans lint`
 *  and `ls`, each allowed the `--json` flag it gains. */
const MIGRATED_COMMANDS: ReadonlyArray<string> = [];

/** What the committed file may declare beyond the frozen one: a path and a declaration's head
 *  (its kind and key). */
const ALLOWED_ADDITIONS: ReadonlyArray<readonly [string, string]> = [
  ["", "after_long_help "],
  ["", "flag --json-schema "],
  ...MIGRATED_COMMANDS.map((path) => [path, "flag --json "] as const),
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
    expect(difference(before, now)).toEqual([]);
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
