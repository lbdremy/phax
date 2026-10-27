import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CODE_REVIEW_ESCAPES,
  CODE_REVIEW_LENSES,
  CODE_REVIEW_SEVERITIES,
} from "../../../src/schemas/codeReview.js";

const skill = readFileSync(
  new URL("../../../.claude/skills/phax-review/SKILL.md", import.meta.url),
  "utf8",
);
const lines = skill.split("\n");

/** A `- **key**:` bullet with its wrapped continuation lines, up to the next `- **` line. */
function bullet(key: string): string {
  const start = lines.findIndex((l) => l.startsWith(`- **${key}**:`));
  if (start < 0) return "";
  const out = [lines[start] ?? ""];
  for (const l of lines.slice(start + 1)) {
    if (l.startsWith("- **") || l.trim() === "") break;
    out.push(l);
  }
  return out.join("\n");
}

const severities = [...bullet("severity").matchAll(/`([a-z-]+)` \(/g)].map((m) => m[1] ?? "");
const lenses = [...bullet("lens").matchAll(/`([a-z-]+)`/g)].map((m) => m[1] ?? "");
const escapes = (() => {
  const header = lines.findIndex((l) => l.startsWith("| Escape |"));
  if (header < 0) return [];
  const ids: string[] = [];
  for (const l of lines.slice(header + 2)) {
    if (!l.startsWith("|")) break;
    const id = /^\|\s*`([a-z-]+)`\s*\|/.exec(l)?.[1];
    if (id !== undefined) ids.push(id);
  }
  return ids;
})();

describe("the bundled phax-review skill and the code-review contract", () => {
  it("lists the same severity ids", () => {
    expect(severities.length).toBeGreaterThan(0);
    expect(severities.toSorted()).toEqual(CODE_REVIEW_SEVERITIES.toSorted());
  });

  it("lists the same lens ids", () => {
    expect(lenses.length).toBeGreaterThan(0);
    expect(lenses.toSorted()).toEqual(CODE_REVIEW_LENSES.toSorted());
  });

  it("lists the same escape ids", () => {
    expect(escapes.length).toBeGreaterThan(0);
    expect(escapes.toSorted()).toEqual(CODE_REVIEW_ESCAPES.toSorted());
  });
});
