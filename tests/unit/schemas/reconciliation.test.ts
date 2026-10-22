import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { readPhaseFileReconciliationFile, withSchemaUrl } from "../../../src/schemas/persisted.js";
import {
  decodePhaseFileReconciliationFile,
  encodePhaseFileReconciliationFile,
} from "../../../src/schemas/reconciliation.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

function stamped<T extends object>(value: T) {
  return withSchemaUrl("phase-file-reconciliation", value);
}

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
  reviewCorrections: [],
  hasDeviations: false,
} as const;

describe("decodePhaseFileReconciliationFile", () => {
  it("accepts a valid persisted reconciliation with $schema and phaseId", () => {
    expect(Either.isRight(decodePhaseFileReconciliationFile(stamped(validPersistedRecon)))).toBe(
      true,
    );
  });

  it("rejects a reconciliation without $schema", () => {
    expect(Either.isLeft(decodePhaseFileReconciliationFile(validPersistedRecon))).toBe(true);
  });

  it("rejects an object missing phaseId", () => {
    const { phaseId: _, ...noPhaseId } = validPersistedRecon;
    expect(Either.isLeft(decodePhaseFileReconciliationFile(stamped(noPhaseId)))).toBe(true);
  });

  it("rejects an empty string phaseId", () => {
    expect(
      Either.isLeft(
        decodePhaseFileReconciliationFile(stamped({ ...validPersistedRecon, phaseId: "" })),
      ),
    ).toBe(true);
  });

  it("rejects an object missing hasDeviations", () => {
    const { hasDeviations: _, ...noHasDeviation } = validPersistedRecon;
    expect(Either.isLeft(decodePhaseFileReconciliationFile(stamped(noHasDeviation)))).toBe(true);
  });

  it("rejects an object missing reviewCorrections", () => {
    const { reviewCorrections: _, ...noCorrections } = validPersistedRecon;
    expect(Either.isLeft(decodePhaseFileReconciliationFile(stamped(noCorrections)))).toBe(true);
  });

  it("round-trips encode/decode, $schema first", () => {
    const encoded = encodePhaseFileReconciliationFile(stamped(validPersistedRecon));
    expect(Object.keys(encoded)[0]).toBe("$schema");
    const decoded = Either.getOrThrow(decodePhaseFileReconciliationFile(encoded));
    expect(decoded.phaseId).toBe("phase-01");
    expect(decoded.createdAsPlanned).toEqual(["src/foo.ts"]);
    expect(decoded.hasDeviations).toBe(false);
  });

  it("round-trips a reconciliation with renames", () => {
    const withRenames = {
      ...validPersistedRecon,
      renames: [{ from: "src/old.ts", to: "src/new.ts" }],
    };
    const encoded = encodePhaseFileReconciliationFile(stamped(withRenames));
    const decoded = Either.getOrThrow(decodePhaseFileReconciliationFile(encoded));
    expect(decoded.renames).toEqual([{ from: "src/old.ts", to: "src/new.ts" }]);
  });
});

describe("readPhaseFileReconciliationFile", () => {
  const { reviewCorrections: _corrections, ...beforeCorrections } = validPersistedRecon;

  it("reads a 0.17.0 reconciliation lifted with reviewCorrections: []", () => {
    const read = readPhaseFileReconciliationFile("file-reconciliation.json", {
      $schema: schemaUrl("phase-file-reconciliation", "0.17.0"),
      ...beforeCorrections,
    });
    expect(Either.getOrThrow(read)).toEqual({ ...validPersistedRecon, reviewCorrections: [] });
  });

  it("reads a pre-schema reconciliation lifted with reviewCorrections: []", () => {
    const read = readPhaseFileReconciliationFile("file-reconciliation.json", beforeCorrections);
    expect(Either.getOrThrow(read).reviewCorrections).toEqual([]);
  });

  it("reads the current shape with its corrections", () => {
    const read = readPhaseFileReconciliationFile(
      "file-reconciliation.json",
      stamped({ ...validPersistedRecon, reviewCorrections: ["src/invoice.ts"] }),
    );
    expect(Either.getOrThrow(read).reviewCorrections).toEqual(["src/invoice.ts"]);
  });

  it("refuses the current stamp without reviewCorrections", () => {
    expect(
      Either.isLeft(
        readPhaseFileReconciliationFile("file-reconciliation.json", stamped(beforeCorrections)),
      ),
    ).toBe(true);
  });
});
