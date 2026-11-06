import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ClaudeSessionId, WorktreePath } from "../../src/domain/branded.js";
import {
  buildCommitBody,
  buildHeldReviewCommitBody,
  buildInteractiveCommitBody,
  gateLogTrailerValue,
  resolveGateLogTrailer,
  type CommitPhaseOptions,
  type InteractiveCommitBodyOptions,
} from "../../src/app/commit.js";
import type { PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";

const HOME = "/home/ada";
const STATE_ROOT = `${HOME}/.phax`;
const RUN = `${STATE_ROOT}/runs/ns.invoices`;
const WORKTREE = `${STATE_ROOT}/worktrees/ns.invoices/phase-02`;
const LOG = join(RUN, "phase-02", "checks-attempt-01.log");
const HELD_LOG = join(RUN, "phase-03", "review-gate", "checks-attempt-01.log");

const commit = { subject: "feat: x", body: "Body text." };
const phase = { id: "phase-02", title: "Row header", commit };

const planPhase: PhaxPlanPhase = {
  ...phase,
  model: "claude-sonnet-5-5",
  effort: "medium",
  planMarkdownAnchor: "#phase-02",
  plannedFilesToCreate: [],
  plannedFilesToEdit: [],
  optionalFilesToEdit: [],
  mode: "headless",
  acceptance: null,
  testLines: [],
};

const phaseOptions = (gateLogPath: string | null): CommitPhaseOptions => ({
  phase: planPhase,
  worktreePath: WORKTREE as WorktreePath,
  phaseFolderPath: join(RUN, "phase-02"),
  runId: "run-1",
  shortName: "invoices",
  sessionId: "sess-secret" as ClaudeSessionId,
  gateLogPath,
  repoRoot: "/repo",
  runPath: RUN,
});

const interactiveOptions = (gateLogPath: string): InteractiveCommitBodyOptions => ({
  phase,
  runId: "run-1",
  shortName: "invoices",
  runPath: RUN,
  gateLogPath,
});

describe("gateLogTrailerValue", () => {
  it("writes a log inside the run folder as its relative POSIX path", () => {
    expect(gateLogTrailerValue(RUN, LOG)).toBe("phase-02/checks-attempt-01.log");
    expect(gateLogTrailerValue(RUN, HELD_LOG)).toBe("phase-03/review-gate/checks-attempt-01.log");
  });

  it("writes none for null and for a log outside the run folder", () => {
    expect(gateLogTrailerValue(RUN, null)).toBe("none");
    expect(gateLogTrailerValue(RUN, `${STATE_ROOT}/elsewhere/a.log`)).toBe("none");
    expect(gateLogTrailerValue(RUN, RUN)).toBe("none");
  });

  it("writes none for a relative or empty log path, whatever the working directory", () => {
    expect(gateLogTrailerValue(RUN, "")).toBe("none");
    expect(gateLogTrailerValue(RUN, "phase-02/checks-attempt-01.log")).toBe("none");
  });
});

describe("resolveGateLogTrailer", () => {
  it("gives back the log path from what was written", () => {
    expect(resolveGateLogTrailer(RUN, gateLogTrailerValue(RUN, LOG))).toBe(LOG);
    expect(resolveGateLogTrailer(RUN, gateLogTrailerValue(RUN, HELD_LOG))).toBe(HELD_LOG);
  });

  it("reads an absolute value as is, and none or null as null", () => {
    expect(resolveGateLogTrailer(RUN, LOG)).toBe(LOG);
    expect(resolveGateLogTrailer(RUN, "none")).toBeNull();
    expect(resolveGateLogTrailer(RUN, null)).toBeNull();
  });
});

describe("commit bodies", () => {
  it("a phase commit carries its trailers in order, with no Worktree or Session-Id", () => {
    expect(buildCommitBody(phaseOptions(LOG))).toBe(
      [
        "Body text.",
        "",
        "---",
        "",
        "Run-Id: run-1",
        "Short-Name: invoices",
        "Phase-Id: phase-02",
        "Phase-Title: Row header",
        "Model: claude-sonnet-5-5",
        "Effort: medium",
        "Gate-Log: phase-02/checks-attempt-01.log",
      ].join("\n"),
    );
  });

  it("interactive and held review commits carry a run-relative Gate-Log and no Worktree", () => {
    expect(buildInteractiveCommitBody(interactiveOptions(LOG))).toBe(
      [
        "Body text.",
        "",
        "---",
        "",
        "Run-Id: run-1",
        "Short-Name: invoices",
        "Phase-Id: phase-02",
        "Phase-Title: Row header",
        "Interactive-Phase: phase-02",
        "Gate-Log: phase-02/checks-attempt-01.log",
      ].join("\n"),
    );
    expect(buildHeldReviewCommitBody(interactiveOptions(HELD_LOG))).toBe(
      [
        "Review corrections to phase-02 (Row header), made by a person at a held stop.",
        "",
        "---",
        "",
        "Run-Id: run-1",
        "Short-Name: invoices",
        "Phase-Title: Row header",
        "Held-Phase: phase-02",
        "Gate-Log: phase-03/review-gate/checks-attempt-01.log",
      ].join("\n"),
    );
  });

  it.each([
    ["phase", (log: string | null) => buildCommitBody(phaseOptions(log))],
    ["interactive", (log: string | null) => buildInteractiveCommitBody(interactiveOptions(log!))],
    ["held", (log: string | null) => buildHeldReviewCommitBody(interactiveOptions(log!))],
  ])("the %s body names no run path, state root or home folder", (name, build) => {
    const logs = [LOG, HELD_LOG, `${STATE_ROOT}/elsewhere/a.log`];
    // Only the phase commit's gate log can be null; the closing commits always have one.
    for (const log of name === "phase" ? [...logs, null] : logs) {
      const body = build(log);
      for (const forbidden of [RUN, STATE_ROOT, HOME, WORKTREE, "sess-secret"]) {
        expect(body).not.toContain(forbidden);
      }
      expect(body).not.toMatch(/^(Worktree|Session-Id):/m);
    }
  });
});
