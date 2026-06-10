import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "../../src/domain/errors.js";
import { decodePhaseStatus, encodePhaseStatus } from "../../src/schemas/status.js";
import {
  archiveRun,
  committedToCleanedUp,
  committedToReviewOpen,
  completeRun,
  failRun,
  interruptRun,
  isPhaseTerminal,
  openRunReview,
  pendingToSettingUp,
  rateLimitPhase,
  rateLimitRun,
  rateLimitedToRunning,
  resumeRateLimitedRun,
  runningToPassed,
  settingUpToRunning,
  skipPhase,
  startRun,
  stopRun,
  TERMINAL_PHASE_STATES,
} from "../../src/domain/state.js";

function assertRight<T>(result: Either.Either<T, unknown>, expected: T): void {
  expect(Either.isRight(result)).toBe(true);
  if (Either.isRight(result)) {
    expect(result.right).toBe(expected);
  }
}

function assertLeft(result: Either.Either<unknown, unknown>): void {
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(result.left).toBeInstanceOf(InvalidTransitionError);
  }
}

describe("Run state transitions", () => {
  describe("startRun", () => {
    it("transitions created → running", () => {
      assertRight(startRun("created"), "running");
    });

    it.each([
      "running",
      "failed",
      "review_open",
      "completed",
      "stopped",
      "archived",
      "interrupted",
    ])("rejects transition from %s", (state) => {
      assertLeft(startRun(state as Parameters<typeof startRun>[0]));
    });
  });

  describe("failRun", () => {
    it("transitions running → failed", () => {
      assertRight(failRun("running"), "failed");
    });

    it.each(["created", "failed", "review_open", "completed"])(
      "rejects transition from %s",
      (state) => {
        assertLeft(failRun(state as Parameters<typeof failRun>[0]));
      },
    );
  });

  describe("stopRun", () => {
    it("transitions running → stopped", () => {
      assertRight(stopRun("running"), "stopped");
    });

    it("rejects from created", () => {
      assertLeft(stopRun("created"));
    });
  });

  describe("interruptRun", () => {
    it("transitions running → interrupted", () => {
      assertRight(interruptRun("running"), "interrupted");
    });

    it("rejects from created", () => {
      assertLeft(interruptRun("created"));
    });
  });

  describe("openRunReview", () => {
    it("transitions running → review_open", () => {
      assertRight(openRunReview("running"), "review_open");
    });

    it("rejects from completed", () => {
      assertLeft(openRunReview("completed"));
    });
  });

  describe("completeRun", () => {
    it("transitions running → completed", () => {
      assertRight(completeRun("running"), "completed");
    });

    it("rejects from created", () => {
      assertLeft(completeRun("created"));
    });
  });

  describe("archiveRun", () => {
    it("transitions review_open → archived", () => {
      assertRight(archiveRun("review_open"), "archived");
    });

    it("transitions completed → archived", () => {
      assertRight(archiveRun("completed"), "archived");
    });

    it.each(["created", "running", "failed", "stopped", "interrupted", "archived"])(
      "rejects transition from %s",
      (state) => {
        assertLeft(archiveRun(state as Parameters<typeof archiveRun>[0]));
      },
    );
  });

  describe("rateLimitRun", () => {
    it("transitions running → rate_limited", () => {
      assertRight(rateLimitRun("running"), "rate_limited");
    });

    it.each(["created", "failed", "review_open", "completed", "rate_limited"])(
      "rejects transition from %s",
      (state) => {
        assertLeft(rateLimitRun(state as Parameters<typeof rateLimitRun>[0]));
      },
    );
  });

  describe("resumeRateLimitedRun", () => {
    it("transitions rate_limited → running", () => {
      assertRight(resumeRateLimitedRun("rate_limited"), "running");
    });

    it.each(["created", "running", "failed", "completed"])(
      "rejects transition from %s",
      (state) => {
        assertLeft(resumeRateLimitedRun(state as Parameters<typeof resumeRateLimitedRun>[0]));
      },
    );
  });

  it("InvalidTransitionError message contains from/to states", () => {
    const result = startRun("running");
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("running");
      expect(result.left.message).toContain("running");
    }
  });
});

describe("Phase state transitions", () => {
  describe("gates_exhausted", () => {
    it("is not terminal", () => {
      expect(TERMINAL_PHASE_STATES.has("gates_exhausted")).toBe(false);
      expect(isPhaseTerminal("gates_exhausted")).toBe(false);
    });

    it("round-trips persisted phase status", () => {
      const status = {
        version: 1,
        phaseId: "phase-01",
        phaseIndex: 0,
        state: "gates_exhausted",
        model: "claude-sonnet-4-6",
        effort: "medium",
        createdAt: "2026-06-10T08:00:00.000Z",
        updatedAt: "2026-06-10T08:05:00.000Z",
        branchName: "phax/gate-first-resume",
      };

      const result = decodePhaseStatus(status);

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right).toEqual(status);
        expect(encodePhaseStatus(result.right)).toEqual(status);
      }
    });
  });

  describe("pendingToSettingUp", () => {
    it("transitions pending → setting_up_worktree", () => {
      assertRight(pendingToSettingUp("pending"), "setting_up_worktree");
    });

    it("rejects from running", () => {
      assertLeft(pendingToSettingUp("running"));
    });
  });

  describe("settingUpToRunning", () => {
    it("transitions setting_up_worktree → running", () => {
      assertRight(settingUpToRunning("setting_up_worktree"), "running");
    });

    it("rejects from pending", () => {
      assertLeft(settingUpToRunning("pending"));
    });
  });

  describe("runningToPassed", () => {
    it("transitions running → passed", () => {
      assertRight(runningToPassed("running"), "passed");
    });

    it("transitions fixing → passed", () => {
      assertRight(runningToPassed("fixing"), "passed");
    });

    it("rejects from pending", () => {
      assertLeft(runningToPassed("pending"));
    });
  });

  describe("committedToCleanedUp", () => {
    it("transitions committed → cleaned_up directly", () => {
      assertRight(committedToCleanedUp("committed"), "cleaned_up");
    });
  });

  describe("committedToReviewOpen", () => {
    it("transitions committed → review_open", () => {
      assertRight(committedToReviewOpen("committed"), "review_open");
    });

    it("rejects from passed", () => {
      assertLeft(committedToReviewOpen("passed"));
    });
  });

  describe("skipPhase", () => {
    it("transitions pending → skipped", () => {
      assertRight(skipPhase("pending"), "skipped");
    });

    it("rejects from running", () => {
      assertLeft(skipPhase("running"));
    });
  });

  describe("rateLimitPhase", () => {
    it.each(["running", "fixing"])("transitions %s → rate_limited", (state) => {
      assertRight(rateLimitPhase(state as Parameters<typeof rateLimitPhase>[0]), "rate_limited");
    });

    it.each(["pending", "passed", "committed", "rate_limited"])(
      "rejects transition from %s",
      (state) => {
        assertLeft(rateLimitPhase(state as Parameters<typeof rateLimitPhase>[0]));
      },
    );
  });

  describe("rateLimitedToRunning", () => {
    it("transitions rate_limited → running", () => {
      assertRight(rateLimitedToRunning("rate_limited"), "running");
    });

    it.each(["pending", "running", "fixing", "passed"])("rejects transition from %s", (state) => {
      assertLeft(rateLimitedToRunning(state as Parameters<typeof rateLimitedToRunning>[0]));
    });
  });
});
