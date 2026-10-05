// The user-facing approval docs name per-artifact record files: the CLI help
// in phax.usage.kdl, the README and the shipped phax-cli and phax-spec skills.
// The old approvals.json ledgers survive only as migration input and in the
// old-ledger rows and upgrade note (spec approval-record-files §5.23, §8, §11).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

const usage = read("phax.usage.kdl");
const readme = read("README.md");
const phaxCliSkill = read(".claude/skills/phax-cli/SKILL.md");
const phaxSpecSkill = read(".claude/skills/phax-spec/SKILL.md");

// The kdl block of one subcommand, from its `cmd "<name>" {` line to the
// closing brace at the same indent.
function kdlBlock(name: string): string {
  const lines = usage.split("\n");
  const start = lines.findIndex((line) => line.trim() === `cmd "${name}" {`);
  if (start === -1) throw new Error(`phax.usage.kdl has no cmd "${name}"`);
  const startLine = lines[start] ?? "";
  const indent = startLine.slice(0, startLine.indexOf("cmd"));
  const end = lines.findIndex((line, index) => index > start && line === `${indent}}`);
  return lines.slice(start, end + 1).join("\n");
}

// Units of prose: a list item or table row starts a new unit, and any other
// line joins the unit above it. kdl stores newlines as the two characters `\n`.
function units(text: string): ReadonlyArray<string> {
  const result: string[] = [];
  for (const line of text.replace(/\\n/g, "\n").split("\n")) {
    if (line.trim() === "") continue;
    const last = result.length - 1;
    if (/^\s*(- |\|)/.test(line) || last < 0) result.push(line);
    else result[last] += `\n${line}`;
  }
  return result;
}

// A unit may name approvals.json only as migration input, as an old-ledger
// row, or inside the upgrade note.
function isAllowedLedgerUnit(unit: string): boolean {
  return (
    unit.includes("migrate-approvals") ||
    unit.includes("old ledger") ||
    unit.includes("**Approval records are per-artifact files.**")
  );
}

describe("approval record docs", () => {
  const transitionHelp = ["approve", "reopen", "abandon", "complete"];

  it.each(transitionHelp)("the %s help names the record file under approvals/", (name) => {
    expect(kdlBlock(name)).toContain("approvals/");
  });

  it("lists migrate-approvals under artifact", () => {
    expect(kdlBlock("artifact")).toContain('cmd "migrate-approvals"');
  });

  it("names approvals.json only as migration input or in the upgrade note", () => {
    const sources = {
      "phax.usage.kdl": usage.replace(kdlBlock("migrate-approvals"), ""),
      "README.md": readme,
      "phax-cli SKILL.md": phaxCliSkill,
      "phax-spec SKILL.md": phaxSpecSkill,
    };
    const offending = Object.entries(sources).flatMap(([source, text]) =>
      units(text)
        .filter((unit) => unit.includes("approvals.json") && !isAllowedLedgerUnit(unit))
        .map((unit) => `${source}: ${unit}`),
    );
    expect(offending).toEqual([]);
  });

  it("documents migrate-approvals with its exit codes in the phax-cli skill", () => {
    const unit = units(phaxCliSkill).find((line) => line.includes("migrate-approvals"));
    expect(unit).toBeDefined();
    expect(unit).toContain("12");
  });

  it("has the README upgrade note", () => {
    expect(readme).toContain("**Approval records are per-artifact files.**");
  });
});
