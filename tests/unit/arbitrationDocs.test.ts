// docs/arbitration.md shows a verdicts file and names `phax artifact decide`
// flags. The example must decode at the format's current stamp, and every flag
// the page names must be declared by the command, as its help on the runner lists them (spec
// artifact-decide-verdicts §11).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { makeArtifactDecideCommand } from "../../src/cli/definitions/artifactDecide.js";
import { decodeDecideVerdictsFile } from "../../src/schemas/decideVerdicts.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { inArtifact, runnerCall } from "../helpers/runnerCall.js";

const page = readFileSync(join(import.meta.dirname, "../../docs/arbitration.md"), "utf8");

describe("docs/arbitration.md", () => {
  it("shows a verdicts file that decodes at the current decide-verdicts stamp", () => {
    const blocks = [...page.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1] ?? "");
    const example = blocks.find((block) => block.includes("decide-verdicts"));
    expect(example).toBeDefined();
    const parsed: unknown = JSON.parse(example ?? "");
    const decoded = decodeDecideVerdictsFile(parsed);
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.right.$schema).toBe(currentSchemaUrl("decide-verdicts"));
    }
  });

  it("names only decide flags that are registered", async () => {
    const help = await runnerCall(
      [inArtifact(makeArtifactDecideCommand())],
      ["artifact", "decide", "--help"],
    );
    expect(help.code).toBe(0);
    const registered = new Set(
      [...help.out.matchAll(/^\s+(?:-\w, )?(--[a-z][a-z-]*)/gm)].map((m) => m[1]),
    );

    const named = new Set<string>();
    for (const line of page.split("\n")) {
      if (!line.includes("phax artifact decide")) continue;
      for (const m of line.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)) named.add(m[0]);
    }
    expect([...named]).toContain("--verdicts");
    for (const flag of named) expect(registered, flag).toContain(flag);
  });
});
