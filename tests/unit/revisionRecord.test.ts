import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodeRecordManifestFile } from "../../src/schemas/authoringRecord.js";
import {
  currentSchemaUrl,
  readRecordManifestFile,
  withSchemaUrl,
} from "../../src/schemas/persisted.js";
import {
  decodeRevisionRecordManifestFile,
  encodeRevisionRecordManifest,
  isRevisionRecordManifest,
  type RevisionRecordManifest,
} from "../../src/schemas/revisionRecord.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

// The revision record manifest (spec artifact-revise): born with `$schema`,
// every key required, one variant per outcome, no session id.

const COMMON = {
  kind: "revision",
  revisionId: "2610160930-log-rotation/01",
  artifact: "docs/specs/2610160930-log-rotation.md",
  artifactKind: "spec",
  session: "resumed-authoring",
  requester: { kind: "operator", name: "Ada Example" },
  newQuestions: ["q-scope"],
  sourceSha: "abc1234",
  shape: "full",
  provider: "claude-code",
  model: "claude-example",
  requestedModel: "claude-example",
  effort: "medium",
  usage: { available: false },
} as const;

const COMMITTED: RevisionRecordManifest = { ...COMMON, outcome: "committed", commit: "def5678" };
const UNCHANGED: RevisionRecordManifest = {
  ...COMMON,
  requester: { kind: "machine", grant: "revise-specs" },
  newQuestions: [],
  outcome: "unchanged",
  commit: null,
};
const FAILED: RevisionRecordManifest = {
  ...COMMON,
  newQuestions: [],
  outcome: "failed",
  commit: null,
  failure: "answer-refused",
};

const OUTCOMES: ReadonlyArray<readonly [string, RevisionRecordManifest]> = [
  ["committed", COMMITTED],
  ["unchanged", UNCHANGED],
  ["failed", FAILED],
];

function file(manifest: RevisionRecordManifest): Record<string, unknown> {
  return { ...encodeRevisionRecordManifest(withSchemaUrl("revision-record-manifest", manifest)) };
}

describe("the revision record manifest", () => {
  it.each(OUTCOMES)("round-trips a %s record with $schema first", (_outcome, manifest) => {
    const written = file(manifest);
    expect(Object.keys(written)[0]).toBe("$schema");
    expect(written["$schema"]).toBe(currentSchemaUrl("revision-record-manifest"));
    expect(written["$schema"]).toBe(schemaUrl("revision-record-manifest", "0.38.0"));
    const decoded = decodeRevisionRecordManifestFile(written);
    if (Result.isFailure(decoded)) throw new Error("decode failed");
    const { $schema: _schema, ...rest } = decoded.success;
    expect(rest).toEqual(manifest);
  });

  it.each(OUTCOMES)("reads a %s record through the record manifest union", (_outcome, manifest) => {
    const written = file(manifest);
    expect(Result.isSuccess(decodeRecordManifestFile(written))).toBe(true);
    const read = readRecordManifestFile("record.json", written);
    if (Result.isFailure(read)) throw new Error("read failed");
    expect(isRevisionRecordManifest(read.success)).toBe(true);
    expect(read.success).toEqual(manifest);
  });

  it.each([
    ["an unknown key", { ...file(COMMITTED), sessionId: "abc" }],
    ["a committed record without a commit", { ...file(COMMITTED), commit: null }],
    ["an unchanged record that names a commit", { ...file(UNCHANGED), commit: "def5678" }],
    ["a failed record that names a commit", { ...file(FAILED), commit: "def5678" }],
    ["a failed record without a failure", { ...file(FAILED), failure: undefined }],
    ["a failure on a committed record", { ...file(COMMITTED), failure: "network" }],
    ["a failure outside the literals", { ...file(FAILED), failure: "bogus" }],
    ["an outcome outside the three", { ...file(COMMITTED), outcome: "declined" }],
    ["a revisionId without a number", { ...file(COMMITTED), revisionId: "2610160930-log" }],
    ["a requester of another kind", { ...file(COMMITTED), requester: { kind: "robot" } }],
    ["no $schema", { ...file(COMMITTED), $schema: undefined }],
  ])("refuses %s", (_label, document) => {
    expect(Result.isFailure(decodeRevisionRecordManifestFile(document))).toBe(true);
    expect(Result.isFailure(readRecordManifestFile("record.json", document))).toBe(true);
  });

  it("is told from the other record kinds by its kind", () => {
    expect(isRevisionRecordManifest(COMMITTED)).toBe(true);
    expect(isRevisionRecordManifest({ kind: "decision" })).toBe(false);
  });
});
