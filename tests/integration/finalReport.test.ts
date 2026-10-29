import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { writeFinalReport } from "../../src/app/finalReport.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { BranchName } from "../../src/domain/branded.js";
import type { PhaseStatus } from "../../src/schemas/status.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { encodeSecurityPosture, type SecurityPosture } from "../../src/schemas/securityPosture.js";
import { phaseStatus } from "../helpers/phaseStatusFixture.js";

const stateRoot = "/fake-state";
const shortName = "test-run";
const runPath = `${stateRoot}/runs/${shortName}`;
const finalBranch = "feature/test-run--phase-02" as BranchName;
const now = "2026-06-12T12:00:00.000Z";

function makePhaseStatus(overrides: Partial<PhaseStatus> = {}): PhaseStatus {
  return phaseStatus({
    phaseId: "phase-01",
    phaseIndex: 0,
    state: "review_open",
    model: "claude-sonnet-4-6",
    effort: "low",
    branchName: "ai/test-run--phase-01",
    base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
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
    version: 3,
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
    protectedPaths: null,
    providerSkippedForSecurity: [],
    stop: null,
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
    // security.json is read through the fs port, like the report is written.
    async function reportWithFiles(
      files: Record<string, string>,
      overrides: Partial<RunReviewInfo> = {},
    ): Promise<string | undefined> {
      const fs = makeFakeFileSystem();
      for (const [path, content] of Object.entries(files)) {
        fs.impl.setFile(`${runPath}/${path}`, content);
      }
      await Effect.runPromise(writeFinalReport(makeInfo(overrides)).pipe(Effect.provide(fs.layer)));
      return fs.impl.getFile(`${runPath}/final-report.md`);
    }

    async function reportWithPostures(
      postures: Record<string, SecurityPosture>,
    ): Promise<string | undefined> {
      return reportWithFiles(
        Object.fromEntries(
          Object.entries(postures).map(([phaseId, p]) => [
            `${phaseId}/security.json`,
            JSON.stringify(encodeSecurityPosture(p)),
          ]),
        ),
      );
    }

    it("names a security.json that does not decode as unreadable, with its first violation", async () => {
      const { stop: _stop, ...withoutStop } = encodeSecurityPosture(posture([]));
      const report = await reportWithFiles({
        "phase-01/security.json": JSON.stringify(encodeSecurityPosture(posture([]))),
        "phase-02/security.json": JSON.stringify(withoutStop),
      });
      const section = report?.split("### Unreadable Security Files")[1]?.split("##")[0];
      expect(section).toContain(`${runPath}/phase-02/security.json\` is unreadable:`);
      expect(section).toContain("stop");
      expect(section).not.toContain("phase-01");
      // The readable phase still has its row.
      expect(report).toMatch(/\| phase-01 \| secure \| claude-code \| /);
    });

    it("names a security.json that is not JSON as unreadable", async () => {
      const report = await reportWithFiles({ "phase-01/security.json": "{ not json" });
      expect(report).toContain("is unreadable: not valid JSON");
    });

    it("reads a version-1 security.json as a phase that never stopped", async () => {
      const { stop: _stop, ...rest } = encodeSecurityPosture(posture([]));
      const report = await reportWithFiles({
        "phase-01/security.json": JSON.stringify({ ...rest, version: 1 }),
      });
      expect(report).toMatch(/\| phase-01 \| secure \| claude-code \| /);
      expect(report).not.toContain("Unreadable Security Files");
    });

    it("lists an interactive phase's turn streams from the phase folder, first turns first", async () => {
      const report = await reportWithFiles(
        {
          "phase-01/closing-turn-01.jsonl": "",
          "phase-01/first-turn-01.jsonl": "",
          "phase-01/first-turn-01-retry.jsonl": "",
          "phase-01/output.jsonl": "",
        },
        { phaseStatuses: [makePhaseStatus({ phaseId: "phase-01", mode: "interactive" })] },
      );
      const turns = [...(report ?? "").matchAll(/- Turn: `[^`]*\/(\S+\.jsonl)`/g)].map((m) => m[1]);
      expect(turns).toEqual([
        "first-turn-01.jsonl",
        "first-turn-01-retry.jsonl",
        "closing-turn-01.jsonl",
      ]);
    });

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
