import { describe, expect, it } from "vitest";
import { cliDocs } from "../../../src/cli/cliDocs.js";

describe("cliDocs.orient", () => {
  it("has an orient entry", () => {
    expect(cliDocs["orient"]).toBeDefined();
  });

  const NORMATIVE_TOKENS = [
    "orient",
    "command",
    "whitespace",
    '{"files"',
    '{"expand"',
    '{"rows"',
    '{"row"',
    '"error"',
    '"warn"',
    '"info"',
    "null",
    "exit",
    "agentCommands",
  ] as const;

  for (const token of NORMATIVE_TOKENS) {
    it(`longHelp contains normative token: ${token}`, () => {
      expect(cliDocs["orient"]?.longHelp).toContain(token);
    });
  }

  it("examples includes a phax orient --file entry", () => {
    const examples = cliDocs["orient"]?.examples ?? [];
    expect(examples.some((e) => e.startsWith("phax orient --file"))).toBe(true);
  });

  it("examples includes a phax orient <id> entry (no --file)", () => {
    const examples = cliDocs["orient"]?.examples ?? [];
    expect(examples.some((e) => e.startsWith("phax orient ") && !e.includes("--file"))).toBe(true);
  });
});
