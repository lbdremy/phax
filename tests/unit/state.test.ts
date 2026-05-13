import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "../../src/domain/errors.js";
import {
  archiveRun,
  cleaningUpToCleanedUp,
  committedToCleanedUp,
  committedToCleaningUp,
  committedToReviewOpen,
  completeRun,
  failPhase,
  failRun,
  fixingToRunning,
  gatesFailedToFixing,
  interruptRun,
  openRunReview,
  passedToCommitted,
  passedToHandoffFailed,
  pendingToSettingUp,
  runningToGatesFailed,
  runningToPassed,
  settingUpToRunning,
  skipPhase,
  startRun,
  stopRun,
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

  it("InvalidTransitionError message contains from/to states", () => {
    const result = startRun("running");
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("running");
      expect(result.left.message).toContain("running");
    }
  });
});

describe("Phase state transitions", () => {
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

  describe("runningToGatesFailed", () => {
    it("transitions running → gates_failed", () => {
      assertRight(runningToGatesFailed("running"), "gates_failed");
    });

    it("rejects from pending", () => {
      assertLeft(runningToGatesFailed("pending"));
    });
  });

  describe("gatesFailedToFixing", () => {
    it("transitions gates_failed → fixing", () => {
      assertRight(gatesFailedToFixing("gates_failed"), "fixing");
    });

    it("rejects from running", () => {
      assertLeft(gatesFailedToFixing("running"));
    });
  });

  describe("fixingToRunning", () => {
    it("transitions fixing → running", () => {
      assertRight(fixingToRunning("fixing"), "running");
    });

    it("rejects from passed", () => {
      assertLeft(fixingToRunning("passed"));
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

  describe("failPhase", () => {
    it.each(["running", "fixing", "gates_failed", "setting_up_worktree"])(
      "transitions %s → failed",
      (state) => {
        assertRight(failPhase(state as Parameters<typeof failPhase>[0]), "failed");
      },
    );

    it("rejects from passed", () => {
      assertLeft(failPhase("passed"));
    });
  });

  describe("passedToCommitted", () => {
    it("transitions passed → committed", () => {
      assertRight(passedToCommitted("passed"), "committed");
    });

    it("rejects from running", () => {
      assertLeft(passedToCommitted("running"));
    });
  });

  describe("committedToCleaningUp", () => {
    it("transitions committed → cleaning_up", () => {
      assertRight(committedToCleaningUp("committed"), "cleaning_up");
    });
  });

  describe("cleaningUpToCleanedUp", () => {
    it("transitions cleaning_up → cleaned_up", () => {
      assertRight(cleaningUpToCleanedUp("cleaning_up"), "cleaned_up");
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

  describe("passedToHandoffFailed", () => {
    it("transitions passed → handoff_failed", () => {
      assertRight(passedToHandoffFailed("passed"), "handoff_failed");
    });

    it("rejects from committed", () => {
      assertLeft(passedToHandoffFailed("committed"));
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
});
