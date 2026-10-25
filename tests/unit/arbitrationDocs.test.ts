// docs/arbitration.md shows a verdicts file and names `phax artifact decide`
// flags. The example must decode at the format's current stamp, and every flag
// the page names must be registered on the command (spec
// artifact-decide-verdicts §11).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { registerArtifactCommand } from "../../src/cli/commands/artifact.js";
import { decodeDecideVerdictsFile } from "../../src/schemas/decideVerdicts.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";

const page = readFileSync(join(import.meta.dirname, "../../docs/arbitration.md"), "utf8");

const output = { log: () => {}, warn: () => {}, error: () => {} };

describe("docs/arbitration.md", () => {
  it("shows a verdicts file that decodes at the current decide-verdicts stamp", () => {
    const blocks = [...page.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1] ?? "");
    const example = blocks.find((block) => block.includes("decide-verdicts"));
    expect(example).toBeDefined();
    const parsed: unknown = JSON.parse(example ?? "");
    const decoded = decodeDecideVerdictsFile(parsed);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right.$schema).toBe(currentSchemaUrl("decide-verdicts"));
    }
  });

  it("names only decide flags that are registered", () => {
    const program = new Command();
    registerArtifactCommand(program, output);
    const decide = program.commands
      .find((c) => c.name() === "artifact")
      ?.commands.find((c) => c.name() === "decide");
    const registered = new Set(decide?.options.map((o) => o.long));

    const named = new Set<string>();
    for (const line of page.split("\n")) {
      if (!line.includes("phax artifact decide")) continue;
      for (const m of line.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)) named.add(m[0]);
    }
    expect([...named]).toContain("--verdicts");
    for (const flag of named) expect(registered, flag).toContain(flag);
  });
});
