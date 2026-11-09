// Acceptance tests of the acceptance loop: what phax's readers give for an older
// record or status document, and for a 0.33.0 one. Each test is expected to fail
// until the record and status formats move to 0.33.0 (`it.fails`).
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  readGateAttributionFile,
  readPhaseStatusFile,
  readRecordManifestFile,
  readRunStatusFile,
} from "../../../src/schemas/persisted.js";
import { liftCases, stampCases, type LiftFormat } from "./acceptanceRecordLiftCases.js";

type Read = (file: string, input: unknown) => Result.Result<unknown, unknown>;

const READERS: Readonly<Record<LiftFormat, Read>> = {
  "run-status": readRunStatusFile,
  "phase-status": readPhaseStatusFile,
  "gate-attribution": readGateAttributionFile,
  "phase-record-manifest": readRecordManifestFile,
};

describe("phax reads an older document under the acceptance names", () => {
  it.each(liftCases)("$label", ({ format, input, expected }) => {
    const result = READERS[format](`/runs/run-0001/${format}.json`, input);
    expect(Result.isSuccess(result)).toBe(true);
    expect(Result.getOrUndefined(result)).toEqual(expected);
  });
});

describe("phax reads a 0.33.0 document with the acceptance names and refuses the oracle names", () => {
  it.each(stampCases)("$label", ({ format, written, expected, refused }) => {
    const read = READERS[format](`/runs/run-0001/${format}.json`, written);
    expect(Result.isSuccess(read)).toBe(true);
    expect(Result.getOrUndefined(read)).toEqual(expected);
    expect(Result.isFailure(READERS[format](`/runs/run-0001/${format}.json`, refused))).toBe(true);
  });
});
