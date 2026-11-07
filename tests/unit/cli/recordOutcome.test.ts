import { describe, expect, it } from "vitest";
import { recordNotes, recordOutcome } from "../../../src/cli/definitions/shared.js";

type Push = { readonly failed: string | null };

const sentences = (branchNote: string | undefined) => ({
  warningOf: () => branchNote,
  pushWarningOf: (push: Push) => push.failed ?? undefined,
  fallback: "record not written",
});

const written = { kind: "written", key: "authoring/2611061447-example" } as const;

describe("recordOutcome", () => {
  it("keeps a diverged-branch note out of pushWarning when the push succeeded", () => {
    const outcome = recordOutcome(written, { failed: null }, sentences("record kept on …"));
    expect(outcome).toEqual({
      kind: "written",
      key: "authoring/2611061447-example",
      branchNote: "record kept on …",
      pushWarning: null,
    });
    expect(recordNotes(outcome)).toBe("record kept on …");
  });

  it("gives a failed push its own field beside the branch note", () => {
    const outcome = recordOutcome(written, { failed: "push refused" }, sentences("kept"));
    expect(outcome).toMatchObject({ branchNote: "kept", pushWarning: "push refused" });
    expect(recordNotes(outcome)).toBe("kept\npush refused");
  });

  it("writes null for both when there is nothing to say", () => {
    const outcome = recordOutcome(written, { failed: null }, sentences(undefined));
    expect(outcome).toMatchObject({ branchNote: null, pushWarning: null });
    expect(recordNotes(outcome)).toBe("");
  });
});
