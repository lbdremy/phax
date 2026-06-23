import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodePhaseFileReconciliation,
  encodePhaseFileReconciliation,
} from "../../../src/schemas/reconciliation.js";

const validPersistedRecon = {
  phaseId: "phase-01",
  createdAsPlanned: ["src/foo.ts"],
  editedAsPlanned: ["src/bar.ts"],
  missingPlannedCreate: [],
  missingPlannedEdit: [],
  createdButPlannedEdit: [],
  editedButPlannedCreate: [],
  unplannedCreated: [],
  unplannedEdited: [],
  optionalTouched: [],
  deletions: [],
  renames: [],
  hasDeviations: false,
} as const;

describe("decodePhaseFileReconciliation", () => {
  it("accepts a valid persisted reconciliation with phaseId", () => {
    expect(Either.isRight(decodePhaseFileReconciliation(validPersistedRecon))).toBe(true);
  });

  it("rejects an object missing phaseId", () => {
    const { phaseId: _, ...noPhaseId } = validPersistedRecon;
    expect(Either.isLeft(decodePhaseFileReconciliation(noPhaseId))).toBe(true);
  });

  it("rejects an empty string phaseId", () => {
    expect(
      Either.isLeft(decodePhaseFileReconciliation({ ...validPersistedRecon, phaseId: "" })),
    ).toBe(true);
  });

  it("rejects an object missing hasDeviations", () => {
    const { hasDeviations: _, ...noHasDeviation } = validPersistedRecon;
    expect(Either.isLeft(decodePhaseFileReconciliation(noHasDeviation))).toBe(true);
  });

  it("round-trips encode/decode", () => {
    const encoded = encodePhaseFileReconciliation(validPersistedRecon);
    const decoded = Either.getOrThrow(decodePhaseFileReconciliation(encoded));
    expect(decoded.phaseId).toBe("phase-01");
    expect(decoded.createdAsPlanned).toEqual(["src/foo.ts"]);
    expect(decoded.hasDeviations).toBe(false);
  });

  it("round-trips a reconciliation with renames", () => {
    const withRenames = {
      ...validPersistedRecon,
      renames: [{ from: "src/old.ts", to: "src/new.ts" }],
    };
    const encoded = encodePhaseFileReconciliation(withRenames);
    const decoded = Either.getOrThrow(decodePhaseFileReconciliation(encoded));
    expect(decoded.renames).toEqual([{ from: "src/old.ts", to: "src/new.ts" }]);
  });
});
