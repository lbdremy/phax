import { describe, expect, it } from "vitest";
import { Either } from "effect";
import { decodeGlobalFileReconciliation } from "../../src/schemas/globalReconciliation.js";

const VALID_ENTRY = {
  path: "src/foo.ts",
  plannedInPhases: ["phase-01"],
  touchedInPhases: ["phase-01"],
  expectedActions: ["create"],
  actualActions: ["added"],
  status: "matched",
  planned: true,
  unplanned: false,
  missing: false,
  extraTouch: false,
  attention: "ok",
};

const VALID_RECONCILIATION = {
  files: [VALID_ENTRY],
  unplanned: [],
  missing: [],
  attentionPoints: [],
};

describe("decodeGlobalFileReconciliation", () => {
  it("decodes a representative global-file-reconciliation.json", () => {
    const result = decodeGlobalFileReconciliation(VALID_RECONCILIATION);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.files).toHaveLength(1);
      expect(result.right.files[0]?.path).toBe("src/foo.ts");
      expect(result.right.files[0]?.actualActions).toContain("added");
    }
  });

  it("decodes entries with deleted and renamed actions", () => {
    const entry = { ...VALID_ENTRY, actualActions: ["deleted", "renamed"], status: "deleted" };
    const result = decodeGlobalFileReconciliation({ ...VALID_RECONCILIATION, files: [entry] });
    expect(Either.isRight(result)).toBe(true);
  });

  it("fails when a required field is missing", () => {
    const { path: _dropped, ...withoutPath } = VALID_ENTRY;
    const result = decodeGlobalFileReconciliation({
      ...VALID_RECONCILIATION,
      files: [withoutPath],
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("fails when status is an unknown value", () => {
    const entry = { ...VALID_ENTRY, status: "completely-unknown-status" };
    const result = decodeGlobalFileReconciliation({ ...VALID_RECONCILIATION, files: [entry] });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("fails when actualActions contains an unknown action", () => {
    const entry = { ...VALID_ENTRY, actualActions: ["teleported"] };
    const result = decodeGlobalFileReconciliation({ ...VALID_RECONCILIATION, files: [entry] });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("fails when attention is not ok or review", () => {
    const entry = { ...VALID_ENTRY, attention: "maybe" };
    const result = decodeGlobalFileReconciliation({ ...VALID_RECONCILIATION, files: [entry] });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("decodes when extra fields are present on entries (forward-compat)", () => {
    const entry = { ...VALID_ENTRY, futureField: "ignored" };
    const result = decodeGlobalFileReconciliation({ ...VALID_RECONCILIATION, files: [entry] });
    expect(Either.isRight(result)).toBe(true);
  });
});
