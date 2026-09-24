import { Effect } from "effect";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeFinalReport } from "../../src/app/finalReport.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { BranchName } from "../../src/domain/branded.js";
import type { PhaseStatus } from "../../src/schemas/status.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { encodeSecurityPosture, type SecurityPosture } from "../../src/schemas/securityPosture.js";

const stateRoot = "/fake-state";
const shortName = "test-run";
const runPath = `${stateRoot}/runs/${shortName}`;
const finalBranch = "feature/test-run--phase-02" as BranchName;
const now = "2026-06-12T12:00:00.000Z";

function makePhaseStatus(overrides: Partial<PhaseStatus> = {}): PhaseStatus {
  return {
    version: 1,
    phaseId: "phase-01",
    phaseIndex: 0,
    state: "review_open",
    model: "claude-sonnet-4-6",
    effort: "low",
    branchName: "ai/test-run--phase-01" as BranchName,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeInfo(overrides: Partial<RunReviewInfo> = {}): RunReviewInfo {
  return {
    namespace: "test-project",
    shortName,
    runId: "test-run-999",
    runState: "review_open",
    branch: "feature/test-run",
    runTitle: "My Run Title",
    finalPhaseBranch: finalBranch,
    stateRoot,
    runPath,
    finalPhaseId: "phase-02",
    finalPhaseTitle: "Final Phase",
    worktreePath: "/fake/wt",
    claudeSessionId: undefined as ClaudeSessionId | undefined,
    gateProfileId: "full",
    phaseStatuses: [
      makePhaseStatus({ phaseId: "phase-01" }),
      makePhaseStatus({ phaseId: "phase-02" }),
    ],
    planPhases: [
      { id: "phase-01", title: "First Phase" },
      { id: "phase-02", title: "Final Phase" },
    ],
    updatedAt: now,
    stoppedReason: undefined,
    lastError: undefined,
    ...overrides,
  };
}

function posture(skillEditGrants: readonly string[]): SecurityPosture {
  return {
    version: 1,
    mode: "secure",
    provider: "claude-code",
    sandboxEnabled: true,
    filesystem: { allowRead: ["/wt"], allowWrite: ["/wt"] },
    network: { profile: "provider-only" },
    mcp: { mode: "disabled", allow: [] },
    downgraded: false,
    marks: [],
    agentCommands: [],
    skillEditGrants,
    providerSkippedForSecurity: [],
  };
}

describe("writeFinalReport", () => {
  it("renders the verified surfaces from the phases' gate-attribution records", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      `${runPath}/phase-01/gate-attribution.json`,
      JSON.stringify({
        phase: "phase-01",
        steps: [{ command: "pnpm format", surface: "local", result: "pass" }],
      }),
    );
    fs.impl.setFile(
      `${runPath}/phase-02/gate-attribution.json`,
      JSON.stringify({
        phase: "phase-02",
        steps: [{ command: "pnpm build", surface: "product", result: "pass" }],
      }),
    );

    await Effect.runPromise(writeFinalReport(makeInfo()).pipe(Effect.provide(fs.layer)));

    const report = fs.impl.getFile(`${runPath}/final-report.md`);
    expect(report).toBeDefined();
    expect(report).toContain("**Surfaces Verified**: local, product");
  });

  it("renders an explicit empty state when no attribution records exist", async () => {
    const fs = makeFakeFileSystem();

    await Effect.runPromise(writeFinalReport(makeInfo()).pipe(Effect.provide(fs.layer)));

    const report = fs.impl.getFile(`${runPath}/final-report.md`);
    expect(report).toBeDefined();
    expect(report).toContain("**Surfaces Verified**: (none)");
  });

  describe("security section", () => {
    // security.json is read from disk (not through the fs port), so the run
    // folder is a real temp dir while the report is written to the fake fs.
    async function reportWithPostures(
      postures: Record<string, SecurityPosture>,
    ): Promise<string | undefined> {
      const realRunPath = mkdtempSync(join(tmpdir(), "phax-final-report-"));
      try {
        for (const [phaseId, p] of Object.entries(postures)) {
          mkdirSync(join(realRunPath, phaseId));
          writeFileSync(
            join(realRunPath, phaseId, "security.json"),
            JSON.stringify(encodeSecurityPosture(p)),
          );
        }
        const fs = makeFakeFileSystem();
        await Effect.runPromise(
          writeFinalReport(makeInfo({ runPath: realRunPath })).pipe(Effect.provide(fs.layer)),
        );
        return fs.impl.getFile(join(realRunPath, "final-report.md"));
      } finally {
        rmSync(realRunPath, { recursive: true, force: true });
      }
    }

    it("lists each phase's granted skill files", async () => {
      const report = await reportWithPostures({
        "phase-01": posture([".claude/skills/foo/SKILL.md", ".claude/skills/foo/references/a.md"]),
        "phase-02": posture([]),
      });
      const section = report?.split("### Skill Edit Grants")[1]?.split("## Per-Phase Artifacts")[0];
      expect(section).toContain(
        "| phase-01 | `.claude/skills/foo/SKILL.md`, `.claude/skills/foo/references/a.md` |",
      );
      expect(section).not.toContain("phase-02");
    });

    it("renders one contiguous security row per phase, labelled by phase id", async () => {
      const report = await reportWithPostures({
        "phase-01": posture([]),
        "phase-02": posture([]),
      });
      const table = report?.split("## Security")[1]?.split("## Per-Phase Artifacts")[0] ?? "";
      const lines = table.split("\n");
      const header = lines.findIndex((l) => l.startsWith("| Phase | Mode | Provider |"));
      expect(header).toBeGreaterThanOrEqual(0);
      // No blank line may split the header, separator and rows (it would end the table).
      expect(lines[header + 2]).toMatch(/^\| phase-01 \| secure \| claude-code \| /);
      expect(lines[header + 3]).toMatch(/^\| phase-02 \| secure \| claude-code \| /);
      expect(lines[header + 2]?.split("|").length).toBe(lines[header]?.split("|").length);
    });

    it("omits the grants section when no phase was granted skill files", async () => {
      const report = await reportWithPostures({
        "phase-01": posture([]),
        "phase-02": posture([]),
      });
      expect(report).toBeDefined();
      expect(report).not.toContain("Skill Edit Grants");
    });
  });
});
