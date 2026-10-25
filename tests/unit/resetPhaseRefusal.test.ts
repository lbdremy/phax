import { describe, expect, it } from "vitest";
import type { PhaseResetRequested } from "../../src/domain/events.js";
import { resetPhaseRefusal, type ResetRefusalInput } from "../../src/domain/resetPhaseRefusal.js";
import type { PhaxState } from "../../src/domain/state.js";
import type { PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import type { PhaseStatus } from "../../src/schemas/status.js";
import { phaseStatus } from "../helpers/phaseStatusFixture.js";

const SHORT_NAME = "refunds";

function status(
  index: number,
  state: PhaseStatus["state"],
  extra: Partial<PhaseStatus> = {},
): PhaseStatus {
  const id = `phase-${String(index + 1).padStart(2, "0")}`;
  return phaseStatus({
    phaseId: id,
    phaseIndex: index,
    state,
    model: "claude-sonnet-5-5",
    effort: "low",
    branchName: `ai/${SHORT_NAME}--${id}`,
    base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    createdAt: "2026-10-25T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
    ...extra,
  });
}

function planPhase(index: number, oracle: PxOracle = null): PhaxPlanPhase {
  const id = `phase-${String(index + 1).padStart(2, "0")}`;
  return {
    id,
    title: `Made-up ${id}`,
    model: "claude-opus-5-5",
    effort: "high",
    planMarkdownAnchor: `#${id}`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    mode: "headless",
    oracle,
    commit: { subject: `feat: ${id}`, body: "Made up." },
  };
}
type PxOracle = PhaxPlanPhase["oracle"];

const RESETTABLE: PhaxState = { run: "failed", cause: "unknown" };
const RUNNING: PhaxState = { run: "running", phase: { state: "running" } };

function event(phaseId: string): PhaseResetRequested {
  return {
    type: "PhaseResetRequested",
    eventId: "00000000-0000-4000-8000-000000000000",
    occurredAt: "2026-10-25T00:00:00.000Z",
    run: "refunds-2026-10-25" as PhaseResetRequested["run"],
    phaseId: phaseId as PhaseResetRequested["phaseId"],
  };
}

const closedAuthored = {
  cause: "declared",
  status: "closed",
  outcome: "corrected",
  oracleStep: "authored",
  closedBy: { name: "Ada Example", email: "ada@example.com" },
} as const;

function input(
  statuses: readonly PhaseStatus[],
  targetIndex: number,
  rest: Partial<ResetRefusalInput> = {},
): ResetRefusalInput {
  const target = statuses[targetIndex]!;
  return {
    shortName: SHORT_NAME,
    runState: "failed",
    target,
    phaseStatuses: statuses,
    planPhases: undefined,
    state: () => RESETTABLE,
    event: event(target.phaseId),
    ...rest,
  };
}

const PAIR_PLAN = [
  planPhase(0),
  planPhase(1, { dischargedBy: "phase-03", files: ["tests/refunds.test.ts"] }),
  planPhase(2),
];

describe("resetPhaseRefusal", () => {
  it("allows the reset of a failed phase with nothing after it", () => {
    expect(resetPhaseRefusal(input([status(0, "committed"), status(1, "failed")], 1))).toBeNull();
  });

  it("allows the reset of the stopped phase of a run awaiting review", () => {
    const stopped = status(1, "awaiting_review", {
      stop: { cause: "declared", status: "waiting" },
    });
    const statuses = [status(0, "committed"), stopped];
    expect(
      resetPhaseRefusal(
        input(statuses, 1, { runState: "awaiting_review", state: () => RESETTABLE }),
      ),
    ).toBeNull();
  });

  it("allows the reset when the plan is unreadable and no later phase is committed", () => {
    const statuses = [status(0, "committed"), status(1, "failed"), status(2, "pending")];
    expect(resetPhaseRefusal(input(statuses, 1, { planPhases: undefined }))).toBeNull();
  });

  it("allows the reset of an oracle phase whose discharge has not started", () => {
    const statuses = [status(0, "committed"), status(1, "failed"), status(2, "pending")];
    expect(resetPhaseRefusal(input(statuses, 1, { planPhases: PAIR_PLAN }))).toBeNull();
  });

  it("refuses a phase that is not the stopped one: an earlier phase", () => {
    const stopped = status(1, "awaiting_review", {
      stop: { cause: "declared", status: "waiting" },
    });
    const statuses = [status(0, "committed"), stopped];
    expect(resetPhaseRefusal(input(statuses, 0, { runState: "awaiting_review" }))).toEqual({
      reason: "phase_not_at_stop",
      message: `Cannot reset "phase-01" of run "refunds": the run is awaiting review at "phase-02". Reset "phase-02" first (\`phax reset-phase refunds phase-02\`).`,
    });
  });

  it("refuses a phase that is not the stopped one: a later phase", () => {
    const stopped = status(0, "awaiting_review", {
      stop: { cause: "declared", status: "waiting" },
    });
    const statuses = [stopped, status(1, "pending")];
    expect(resetPhaseRefusal(input(statuses, 1, { runState: "awaiting_review" }))).toEqual({
      reason: "phase_not_at_stop",
      message: `Cannot reset "phase-02" of run "refunds": the run is awaiting review at "phase-01". "phase-02" has not started.`,
    });
  });

  it("refuses an oracle phase whose discharge is stopped at its gate, with the recovery", () => {
    const statuses = [status(0, "committed"), status(1, "committed"), status(2, "failed")];
    expect(resetPhaseRefusal(input(statuses, 1, { planPhases: PAIR_PLAN }))).toEqual({
      reason: "phase_blocked_by_discharge",
      message: `Cannot reset "phase-02" of run "refunds": its discharging phase "phase-03" is failed, and a committed oracle phase is not reset. To correct the oracle, edit it in phase-03 (\`phax enter-phase refunds phase-03\`), then run \`phax resume refunds --yes --skip-oracle\`: the configured gate still runs.`,
    });
  });

  it("refuses an oracle phase whose discharge is past its gate, without the recovery", () => {
    const statuses = [status(0, "committed"), status(1, "committed"), status(2, "review_open")];
    expect(resetPhaseRefusal(input(statuses, 1, { planPhases: PAIR_PLAN }))).toEqual({
      reason: "phase_blocked_by_discharge",
      message: `Cannot reset "phase-02" of run "refunds": its discharging phase "phase-03" is review_open, and a committed oracle phase is not reset.`,
    });
  });

  describe("a closed authored stop", () => {
    const plan = [
      planPhase(0),
      planPhase(1, { dischargedBy: "phase-04", files: ["tests/refunds.test.ts"] }),
      { ...planPhase(2), mode: "interactive" as const },
      planPhase(3),
    ];
    const reviewed = (discharge: PhaseStatus["state"]) => [
      status(0, "cleaned_up"),
      status(1, "cleaned_up"),
      status(2, "cleaned_up", { mode: "interactive", stop: closedAuthored }),
      status(3, discharge),
    ];

    it("refuses once the pair's discharge has started, with single quotes and the recovery", () => {
      expect(resetPhaseRefusal(input(reviewed("failed"), 2, { planPhases: plan }))).toEqual({
        reason: "phase_blocked_by_discharge",
        message: `Cannot reset 'phase-03' of run 'refunds': its discharging phase 'phase-04' is failed, and the discharge judges this phase's commit. To correct the oracle, edit it in phase-04 (\`phax enter-phase refunds phase-04\`), then run \`phax resume refunds --yes --skip-oracle\`: the configured gate still runs.`,
      });
    });

    it("names no recovery once the discharge is past its gate", () => {
      expect(resetPhaseRefusal(input(reviewed("review_open"), 2, { planPhases: plan }))).toEqual({
        reason: "phase_blocked_by_discharge",
        message: `Cannot reset 'phase-03' of run 'refunds': its discharging phase 'phase-04' is review_open, and the discharge judges this phase's commit.`,
      });
    });

    it("adds no such refusal before the discharge starts", () => {
      expect(
        resetPhaseRefusal(input(reviewed("pending"), 2, { planPhases: plan }))?.reason,
      ).not.toBe("phase_blocked_by_discharge");
    });
  });

  it("refuses a phase with a later committed phase", () => {
    const statuses = [status(0, "gates_exhausted"), status(1, "committed")];
    expect(resetPhaseRefusal(input(statuses, 0))).toEqual({
      reason: "phase_blocked_by_later_committed",
      message: `Cannot reset "phase-01" of run "refunds": later phase "phase-02" is already committed.`,
    });
  });

  it("refuses a phase with a later cleaned-up phase", () => {
    const statuses = [status(0, "gates_exhausted"), status(1, "cleaned_up")];
    expect(resetPhaseRefusal(input(statuses, 0))?.reason).toBe("phase_blocked_by_later_committed");
  });

  it("refuses with not_resettable when the reducer does not handle the event", () => {
    const statuses = [status(0, "running")];
    expect(
      resetPhaseRefusal(input(statuses, 0, { runState: "running", state: () => RUNNING })),
    ).toEqual({
      reason: "not_resettable",
      message: `Cannot reset phase "phase-01" of run "refunds": cannot reset phase while it is running.`,
    });
  });

  describe("when two refusals apply, the first in order wins", () => {
    it("not at the stop beats a discharge that has started", () => {
      const stopped = status(2, "awaiting_review", {
        stop: { cause: "declared", status: "waiting" },
      });
      const statuses = [status(0, "committed"), status(1, "committed"), stopped];
      const result = resetPhaseRefusal(
        input(statuses, 1, { runState: "awaiting_review", planPhases: PAIR_PLAN }),
      );
      expect(result?.reason).toBe("phase_not_at_stop");
    });

    it("a discharge that has started beats a later committed phase", () => {
      const statuses = [status(0, "committed"), status(1, "committed"), status(2, "committed")];
      const result = resetPhaseRefusal(input(statuses, 1, { planPhases: PAIR_PLAN }));
      expect(result?.reason).toBe("phase_blocked_by_discharge");
    });

    it("a later committed phase beats not_resettable, and the state is not composed", () => {
      const statuses = [status(0, "running"), status(1, "committed")];
      const result = resetPhaseRefusal(
        input(statuses, 0, {
          state: () => {
            throw new Error("composed too early");
          },
        }),
      );
      expect(result?.reason).toBe("phase_blocked_by_later_committed");
    });
  });
});
