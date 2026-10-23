import type { BranchName } from "../../src/domain/branded.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { DeclaredReviewStop, HeldReviewStop } from "../../src/schemas/reviewStop.js";
import type { PhaseStatus } from "../../src/schemas/status.js";

/**
 * The facts a test gives a phase status: every required field but `mode` and
 * `stop`, which default to a headless phase that never stopped, with the
 * branch name as a plain string.
 */
export type PhaseStatusFields = Omit<PhaseStatus, "mode" | "stop" | "branchName"> &
  Partial<Pick<PhaseStatus, "mode" | "stop">> & { readonly branchName: string };

/** A phase status in memory: `mode: "headless"` and `stop: null` unless given. */
export function phaseStatus(fields: PhaseStatusFields): PhaseStatus {
  return {
    mode: "headless",
    stop: null,
    ...fields,
    branchName: fields.branchName as BranchName,
  };
}

/**
 * A phase's `status.json` as phax writes it: `$schema` at the format's
 * current stamp first, then the status.
 */
export function phaseStatusFile(fields: PhaseStatusFields) {
  return { $schema: currentSchemaUrl("phase-status"), ...phaseStatus(fields) };
}

/**
 * The review stop a run writes at a declared stop on phase-03 of the made-up
 * invoice-export run, before any close.
 */
export function reviewStop(overrides: Partial<DeclaredReviewStop> = {}): DeclaredReviewStop {
  const worktree = "/example/worktrees/invoice-export/phase-03";
  return {
    run: "example.invoice-export",
    state: "awaiting_review",
    cause: "declared",
    phase: {
      id: "phase-03",
      title: "Export the credit notes",
      mode: "interactive",
      position: 3,
      of: 4,
    },
    firstReading: "/example/runs/invoice-export/phase-03/first-reading.md",
    worktree,
    seed: `${worktree}/.phax-context/review-seed.md`,
    session: {
      provider: "claude-code",
      sessionId: "4f6c1a52-0000-4000-8000-000000000001",
      origin: "first-turn",
      interactiveResume: "verified",
    },
    commands: {
      continue: {
        cwd: worktree,
        argv: ["claude", "--resume", "4f6c1a52-0000-4000-8000-000000000001"],
        env: {},
      },
      freshStart: { cwd: worktree, argv: ["claude"], env: {} },
      enterPhase: {
        cwd: "/example/repo",
        argv: ["phax", "enter-phase", "invoice-export", "phase-03"],
        env: {},
      },
      close: { cwd: "/example/repo", argv: ["phax", "resume", "invoice-export"], env: {} },
      reset: {
        cwd: "/example/repo",
        argv: ["phax", "reset-phase", "invoice-export", "phase-03"],
        env: {},
      },
    },
    lastClose: null,
    closeBase: null,
    ...overrides,
  };
}

/**
 * The review stop a run writes at a held stop on phase-02 of the made-up
 * invoice-export run, before any close: the builder session is current.
 */
export function heldReviewStop(overrides: Partial<HeldReviewStop> = {}): HeldReviewStop {
  const worktree = "/example/worktrees/invoice-export/phase-02";
  return {
    run: "example.invoice-export",
    state: "awaiting_review",
    cause: "held",
    phase: {
      id: "phase-02",
      title: "Write the credit-note rows",
      mode: "headless",
      position: 2,
      of: 4,
    },
    phaseCommit: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    worktree,
    seed: `${worktree}/.phax-context/review-seed.md`,
    session: {
      provider: "claude-code",
      sessionId: "4f6c1a52-0000-4000-8000-0000000000b1",
      origin: "builder",
      interactiveResume: "verified",
    },
    commands: {
      continue: {
        cwd: worktree,
        argv: ["claude", "--resume", "4f6c1a52-0000-4000-8000-0000000000b1"],
        env: {},
      },
      freshStart: { cwd: worktree, argv: ["claude"], env: {} },
      enterPhase: {
        cwd: "/example/repo",
        argv: ["phax", "enter-phase", "invoice-export", "phase-02"],
        env: {},
      },
      close: { cwd: "/example/repo", argv: ["phax", "resume", "invoice-export"], env: {} },
      reset: {
        cwd: "/example/repo",
        argv: ["phax", "reset-phase", "invoice-export", "phase-02"],
        env: {},
      },
    },
    lastClose: null,
    closeBase: null,
    ...overrides,
  };
}
