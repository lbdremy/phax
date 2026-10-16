import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeRecordManifestFile } from "../../src/schemas/authoringRecord.js";
import {
  decodeDecisionRecordManifestFile,
  encodeDecisionRecordManifest,
  isDecisionRecordManifest,
  type DecisionRecordManifest,
} from "../../src/schemas/decisionRecord.js";
import {
  currentSchemaUrl,
  readRecordManifestFile,
  withSchemaUrl,
} from "../../src/schemas/persisted.js";

// The decision record manifest (spec artifact-decide §5.30): born with
// `$schema`, every key required, explicit per-outcome variants, no session id.

const MANIFEST: DecisionRecordManifest = {
  kind: "decision",
  decisionId: "2610160930-log-rotation/01",
  artifact: "docs/specs/2610160930-log-rotation.md",
  artifactKind: "spec",
  mode: "interactive",
  session: "resumed-authoring",
  doctrine: [
    { kind: "skill", name: "phax-decide-spec", source: "project", fingerprint: "a".repeat(64) },
    { kind: "file", path: "docs/doctrine/spec.md", fingerprint: "b".repeat(64) },
  ],
  questions: ["Q1", "Q2"],
  arbitrated: 2,
  departed: 1,
  sourceSha: "abc1234",
  shape: "full",
  provider: "claude-code",
  model: "claude-opus-5-5",
  effort: "high",
  outcome: "committed",
  commit: "def5678",
  usage: { available: false },
};

const FILE = withSchemaUrl("decision-record-manifest", MANIFEST) as Record<string, unknown>;

function decodes(input: unknown): boolean {
  return Either.isRight(decodeDecisionRecordManifestFile(input));
}

describe("decision record manifest", () => {
  it("decodes a committed manifest, $schema first, and round-trips through the encoder", () => {
    expect(Object.keys(FILE)[0]).toBe("$schema");
    expect(FILE["$schema"]).toBe(currentSchemaUrl("decision-record-manifest"));
    const decoded = decodeDecisionRecordManifestFile(FILE);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) expect(encodeDecisionRecordManifest(decoded.right)).toEqual(FILE);
  });

  it.each(["declined", "undecided", "failed"] as const)(
    "decodes a %s manifest, which names no commit",
    (outcome) => {
      expect(decodes({ ...FILE, outcome, commit: null, arbitrated: 0, departed: 0 })).toBe(true);
    },
  );

  it("refuses a commit on an uncommitted outcome, and none on a committed one", () => {
    expect(decodes({ ...FILE, outcome: "declined" })).toBe(false);
    expect(decodes({ ...FILE, commit: null })).toBe(false);
  });

  it("refuses an unknown key, a session id among them", () => {
    expect(decodes({ ...FILE, reviewer: "human" })).toBe(false);
    expect(decodes({ ...FILE, sessionId: "5f0c2a71-1b9e-4c55-9a43-6a2d1f6e8b10" })).toBe(false);
  });

  it("refuses a manifest missing any key, commit included", () => {
    for (const key of Object.keys(FILE)) {
      const { [key]: _dropped, ...rest } = FILE;
      expect(decodes(rest), key).toBe(false);
    }
  });

  it("refuses an outcome, a mode or a session outside its literals", () => {
    expect(decodes({ ...FILE, outcome: "paused", commit: null })).toBe(false);
    expect(decodes({ ...FILE, mode: "headless" })).toBe(false);
    expect(decodes({ ...FILE, session: "resumed" })).toBe(false);
  });

  it("refuses a malformed decision id, fingerprint or count", () => {
    expect(decodes({ ...FILE, decisionId: "2610160930-log-rotation" })).toBe(false);
    expect(
      decodes({
        ...FILE,
        doctrine: [
          { kind: "skill", name: "phax-decide-spec", source: "bundled", fingerprint: "abc" },
        ],
      }),
    ).toBe(false);
    expect(decodes({ ...FILE, arbitrated: -1 })).toBe(false);
    expect(decodes({ ...FILE, departed: 1.5 })).toBe(false);
  });

  it("refuses a $schema naming another format", () => {
    expect(decodes({ ...FILE, $schema: currentSchemaUrl("authoring-record-manifest") })).toBe(
      false,
    );
  });

  it("joins the record manifest union, told apart by its kind", () => {
    const decoded = decodeRecordManifestFile(FILE);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) expect(isDecisionRecordManifest(decoded.right)).toBe(true);
  });

  it("is read by the bridge without its $schema, and refused without one", () => {
    const read = readRecordManifestFile("sha:decision/x/01/record.json", FILE);
    expect(read).toEqual(Either.right(MANIFEST));
    const { $schema: _schema, ...bare } = FILE;
    const unstamped = readRecordManifestFile("sha:decision/x/01/record.json", bare);
    expect(Either.isLeft(unstamped)).toBe(true);
    if (Either.isLeft(unstamped)) expect(unstamped.left.message).toContain("has no $schema");
  });
});
