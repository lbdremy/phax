import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  DECIDE_SKILL_FOR_KIND,
  assembleDoctrine,
  principleIdsOf,
} from "../../../src/domain/decide/doctrine.js";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const range = (prefix: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i)}`);
const sorted = (xs: readonly string[]): string[] => xs.toSorted();

const SKILL = [
  "# Made-up doctrine",
  "",
  "1. **Weigh the loss** (`K0`). Name it first.",
  "2. `G0` opens this numbered item.",
  "3) `G1` opens this one too.",
  "",
  "- `K1` (`G0`) **Keep the default.**",
  "* `K2` **Refuse, don't warn.**",
  "+ `K3` **Be total.**",
  "  - `K4` nested bullet",
  "- **Prose first** then `K5` later",
  "- `K1` again, deduplicated",
  "- `9x` not an id",
  "",
  "```md",
  "- `K6` inside a fence",
  "```",
  "",
  "~~~",
  "- `K7` inside a tilde fence",
  "~~~",
  "",
  "Not a list `K8`.",
].join("\n");

describe("DECIDE_SKILL_FOR_KIND", () => {
  it("names the doctrine skill per kind", () => {
    expect(DECIDE_SKILL_FOR_KIND).toEqual({ spec: "phax-decide-spec", plan: "phax-decide-plan" });
  });
});

describe("principleIdsOf", () => {
  it("returns the ids that open list items, in order, deduplicated, outside fences", () => {
    expect(principleIdsOf(SKILL)).toEqual(["G0", "G1", "K1", "K2", "K3", "K4"]);
  });

  it("counts only the opening id, never a parenthesised or prose one", () => {
    expect(principleIdsOf("- `S1` (`C1`) **Adopt…**")).toEqual(["S1"]);
    expect(principleIdsOf("3. **Adopt the recommendation** (`S1`)")).toEqual([]);
  });

  it("returns nothing for text without list items", () => {
    expect(principleIdsOf("# Title\n\nJust `X1` prose.\n")).toEqual([]);
  });
});

describe("assembleDoctrine", () => {
  const skill = { name: "phax-decide-spec", source: "bundled" as const, text: SKILL };

  it("returns the skill alone when no file is given", () => {
    const result = assembleDoctrine({ skill, file: null });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;
    expect(result.right.text).toBe(SKILL);
    expect([...result.right.principleIds]).toEqual(["G0", "G1", "K1", "K2", "K3", "K4"]);
    expect(result.right.sources).toEqual([
      { kind: "skill", name: "phax-decide-spec", source: "bundled", fingerprint: sha(SKILL) },
    ]);
  });

  it("appends the file under its heading and adds its ids and fingerprint", () => {
    const fileText = "- `X1` **Project rule.**\n";
    const result = assembleDoctrine({
      skill: { ...skill, source: "project" },
      file: { path: "docs/doctrine/spec.md", text: fileText },
    });
    if (Either.isLeft(result)) throw new Error(result.left);
    expect(result.right.text).toBe(
      `${SKILL}\n\n## Project doctrine (docs/doctrine/spec.md)\n\n${fileText}`,
    );
    expect(result.right.principleIds.has("X1")).toBe(true);
    expect(result.right.principleIds.has("K1")).toBe(true);
    expect(result.right.sources).toEqual([
      { kind: "skill", name: "phax-decide-spec", source: "project", fingerprint: sha(SKILL) },
      { kind: "file", path: "docs/doctrine/spec.md", fingerprint: sha(fileText) },
    ]);
  });

  it("refuses a file that defines no principle id, naming its path", () => {
    const result = assembleDoctrine({
      skill,
      file: { path: "docs/doctrine/empty.md", text: "Prose naming `X1` only.\n" },
    });
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) return;
    expect(result.left).toContain("docs/doctrine/empty.md");
    expect(result.left).toContain("defines no principle id");
  });

  it("refuses a file that redefines skill ids, naming every overlap", () => {
    const result = assembleDoctrine({
      skill,
      file: { path: "docs/doctrine/clash.md", text: "- `K1` mine\n- `X1` ok\n- `K3` mine too\n" },
    });
    if (Either.isRight(result)) throw new Error("expected a refusal");
    expect(result.left).toContain("docs/doctrine/clash.md");
    expect(result.left).toContain("`K1`");
    expect(result.left).toContain("`K3`");
    expect(result.left).not.toContain("`X1`");
  });
});

const ids = (name: string): readonly string[] =>
  principleIdsOf(readFileSync(`.claude/skills/${name}/SKILL.md`, "utf8"));

describe("shipped doctrine skills", () => {
  it("phax-decide-spec defines exactly E0, C1–C5 and S1–S10 (S0 stays prose)", () => {
    expect(sorted(ids("phax-decide-spec"))).toEqual(
      sorted(["E0", ...range("C", 1, 5), ...range("S", 1, 10)]),
    );
  });

  it("phax-decide-plan defines exactly E0, C1–C5 and P1–P9", () => {
    expect(sorted(ids("phax-decide-plan"))).toEqual(
      sorted(["E0", ...range("C", 1, 5), ...range("P", 1, 9)]),
    );
  });
});
