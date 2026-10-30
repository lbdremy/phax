import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STRUCTURED_CALLS } from "../../src/domain/session/structuredCalls.js";

// The per-provider table of docs/structured-answers.md is held equal to
// STRUCTURED_CALLS: a flip of a call's Claude Code line that misses its docs
// row fails here.
const PAGE = readFileSync(new URL("../../docs/structured-answers.md", import.meta.url), "utf8");

/** The table rows under "One schema, handed three ways": [call, claude, codex, vibe]. */
function tableRows(): string[][] {
  const section = PAGE.split("\n## ")
    .find((part) => part.startsWith("One schema, handed three ways"))
    ?.split("\n");
  return (section ?? [])
    .filter((line) => line.startsWith("|"))
    .slice(2)
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

describe("docs/structured-answers.md", () => {
  const rows = tableRows();

  it("lists exactly the calls of STRUCTURED_CALLS, in order", () => {
    expect(rows.map(([call]) => call)).toEqual(
      Object.keys(STRUCTURED_CALLS).map((call) => `\`${call}\``),
    );
  });

  it("states each call's Claude Code delivery as the table does", () => {
    for (const [call, claude] of rows) {
      const id = call!.replaceAll("`", "") as keyof typeof STRUCTURED_CALLS;
      const expected = STRUCTURED_CALLS[id].claudeCode === "native" ? "`--json-schema`" : "prompt";
      expect(claude, id).toBe(expected);
    }
  });

  it("states Codex natively and Mistral Vibe in the prompt on every row", () => {
    for (const [call, , codex, vibe] of rows) {
      expect(codex, call).toBe("`--output-schema`");
      expect(vibe, call).toBe("schema in prompt");
    }
  });
});
