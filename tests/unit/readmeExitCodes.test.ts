// The README's Exit codes table and the code's exit-code meanings: checks
// the table lists exactly EXIT_CODE_MEANINGS, that one sample error per
// family maps to its code, and that every numeric command return is listed
// (spec run-prune §5.21).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ArchiveBlockedByDirtyWorktreeError,
  AgentInvocationError,
  ApprovalRecordUnreadableError,
  GateFailedError,
  InvalidArtifactTransitionError,
  LockConflictError,
  PhaseHadNoChangesError,
  PlanValidationError,
  RateLimitError,
  RegistryCorruptionError,
  SecurityPreflightError,
  UnsafeGitStateError,
} from "../../src/domain/errors.js";
import { EXIT_CODE_MEANINGS, exitCodeForError } from "../../src/cli/commands/runLayers.js";

const readme = readFileSync(join(import.meta.dirname, "../../README.md"), "utf8");
const commandsDir = join(import.meta.dirname, "../../src/cli/commands");

type ExitCodeMeaning = { readonly code: number; readonly meaning: string };

function exitCodeTableRows(): ReadonlyArray<ExitCodeMeaning> {
  const heading = "## Exit codes";
  const headingIndex = readme.indexOf(heading);
  if (headingIndex === -1) throw new Error(`README.md has no "${heading}" section`);
  const afterHeading = readme.slice(headingIndex + heading.length);
  const nextHeadingIndex = afterHeading.search(/\n## /);
  const section = nextHeadingIndex === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIndex);
  const lines = section.split("\n").filter((line) => line.trim().startsWith("|"));
  // Drop the header row and the `| --- |` separator row.
  return lines.slice(2).map((line) => {
    const [code, meaning] = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    return { code: Number(code), meaning: meaning ?? "" };
  });
}

function compareExitCodeTables(
  readmeRows: ReadonlyArray<ExitCodeMeaning>,
  code: ReadonlyArray<ExitCodeMeaning>,
): string[] {
  const messages: string[] = [];
  const inReadme = new Map(readmeRows.map((row) => [row.code, row.meaning]));
  const inCode = new Map(code.map((row) => [row.code, row.meaning]));
  for (const [codeValue, meaning] of inCode) {
    const readmeMeaning = inReadme.get(codeValue);
    if (readmeMeaning === undefined) {
      messages.push(`exit code ${codeValue}: missing from the README table`);
    } else if (readmeMeaning !== meaning) {
      messages.push(
        `exit code ${codeValue}: README says '${readmeMeaning}', code says '${meaning}'`,
      );
    }
  }
  for (const codeValue of inReadme.keys()) {
    if (!inCode.has(codeValue)) {
      messages.push(`exit code ${codeValue}: listed in the README table but not in the code`);
    }
  }
  return messages;
}

const readmeRows = exitCodeTableRows();
const codes = new Set(EXIT_CODE_MEANINGS.map((row) => row.code));

describe("README exit-code table", () => {
  it("lists exactly EXIT_CODE_MEANINGS, byte-identical meanings", () => {
    expect(compareExitCodeTables(readmeRows, EXIT_CODE_MEANINGS)).toEqual([]);
  });

  it("names the code in every disagreement it reports", () => {
    const mutated = EXIT_CODE_MEANINGS.map((row) =>
      row.code === 7 ? { code: 7, meaning: "Gate failure" } : row,
    );
    const messages = compareExitCodeTables(readmeRows, mutated);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("7");
  });
});

describe("exitCodeForError families", () => {
  const FAMILY_SAMPLES: ReadonlyArray<readonly [number, unknown]> = [
    [2, new PlanValidationError({ message: "bad plan" })],
    [3, new UnsafeGitStateError({ message: "dirty", repoPath: "/tmp/repo" })],
    [
      4,
      new GateFailedError({
        message: "gate failed",
        command: "pnpm test",
        exitCode: 1,
        logPath: "/tmp/gate.log",
        diagnostics: [],
      }),
    ],
    [5, new AgentInvocationError({ message: "agent failed" })],
    [
      6,
      new ArchiveBlockedByDirtyWorktreeError({
        message: "dirty worktree",
        worktreePath: "/tmp/worktree",
      }),
    ],
    [
      7,
      new LockConflictError({
        message: "locked",
        shortName: "x",
        lockPath: "/tmp/lock",
        lockingPid: 1,
      }),
    ],
    [8, new RateLimitError({ message: "rate limit", rawMessage: "429" })],
    [
      9,
      new PhaseHadNoChangesError({
        message: "no changes",
        phaseId: "phase-01",
        worktreePath: "/tmp/worktree",
        runPath: "/tmp/run",
      }),
    ],
    [10, new RegistryCorruptionError({ message: "corrupt", registryPath: "/tmp/registry.json" })],
    [11, new SecurityPreflightError({ message: "missing tools", missing: ["git"] })],
    [
      12,
      new InvalidArtifactTransitionError({
        kind: "plan",
        from: "draft",
        to: "archived",
        legalTargets: [],
      }),
    ],
    [
      12,
      new ApprovalRecordUnreadableError({
        message: "docs/plans/approvals/2601010000-made-up-plan.json: not valid JSON",
        recordPath: "docs/plans/approvals/2601010000-made-up-plan.json",
      }),
    ],
  ];

  it.each(FAMILY_SAMPLES)("maps a sample error to exit code %i", (code, sample) => {
    expect(exitCodeForError(sample)).toBe(code);
  });

  it("maps an unknown error to 1", () => {
    expect(exitCodeForError(new Error("x"))).toBe(1);
  });

  it("only returns codes that EXIT_CODE_MEANINGS lists", () => {
    for (const [code] of FAMILY_SAMPLES) {
      expect(codes.has(code)).toBe(true);
    }
    expect(codes.has(exitCodeForError(new Error("x")))).toBe(true);
  });
});

describe("command numeric returns", () => {
  // Non-exit-code numeric returns that the scan would otherwise match. None
  // exist today; add `file:value` entries here with a reason if one appears.
  const NON_EXIT_CODE_RETURNS: ReadonlyArray<string> = [];

  it("returns only codes that EXIT_CODE_MEANINGS lists", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(commandsDir).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(join(commandsDir, file), "utf8");
      for (const match of source.matchAll(/\breturn (\d+);/g)) {
        const value = Number(match[1]);
        if (codes.has(value)) continue;
        if (NON_EXIT_CODE_RETURNS.includes(`${file}:${value}`)) continue;
        offenders.push(`${file}: return ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
