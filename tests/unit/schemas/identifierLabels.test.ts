// Each identifier-like leaf of the current formats is named by its label in a
// refusal (`Expected PhaseId, actual "not valid"`), not by its regular
// expression, as Effect 3 named it. Each row decodes a document of the format
// through its public decoder (the corpus replay of `format:<id>`): the
// format's `constraint <leaf> pattern` case, restamped to the current release,
// with the leaf set to a value no in-scope pattern accepts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { parseCorpusFile } from "../../behaviourCorpus/corpus.js";
import { replay } from "../../behaviourCorpus/subjects.js";
import { CodeReviewFindingIdSchema } from "../../../src/schemas/codeReview.js";
import { ComplianceFindingIdSchema } from "../../../src/schemas/complianceReview.js";
import { decodeFindingFateRecordManifestFile } from "../../../src/schemas/findingFateRecord.js";
import { decodePhaseAgentBinding } from "../../../src/schemas/phaseAgentBinding.js";
import { firstRefusal } from "../../../src/schemas/refusal/adapter.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { isFormatId, schemaUrl } from "../../../src/schemas/schemaUrl.js";

const BAD = "not valid";

const casesRoot = fileURLToPath(new URL("../../behaviourCorpus/cases/formats/", import.meta.url));

type Path = ReadonlyArray<string | number>;

// The document of the format's case `caseName`, stamped with the current
// release, with `path` set to `value`.
function documentWithBadLeaf(
  format: string,
  caseName: string,
  path: Path,
  value: unknown,
): unknown {
  const file = parseCorpusFile(readFileSync(`${casesRoot}${format}.json`, "utf8"), format);
  if (!("format" in file)) throw new Error(`${format}: not a format case file`);
  if (!isFormatId(format)) throw new Error(`${format}: not a format id`);
  const found = file.current.find((c) => c.name === caseName);
  if (found === undefined) throw new Error(`${format}: no case ${JSON.stringify(caseName)}`);
  const document = objectAt(structuredClone(found.input), format);
  const stamp: string | undefined = (CURRENT_STAMPS as Readonly<Record<string, string>>)[format];
  if (stamp !== undefined && typeof document["$schema"] === "string") {
    document["$schema"] = schemaUrl(format, stamp);
  }
  let at = document;
  for (const key of path.slice(0, -1)) at = objectAt(at[key], `${format} ${String(key)}`);
  at[path.at(-1)!] = value;
  return document;
}

// An object or an array of the document, read by key.
function objectAt(value: unknown, where: string): Record<string | number, unknown> {
  if (!isIndexable(value)) throw new Error(`${where}: not an object or an array`);
  return value;
}

function isIndexable(value: unknown): value is Record<string | number, unknown> {
  return typeof value === "object" && value !== null;
}

const rows: ReadonlyArray<{
  readonly format: string;
  readonly leaf: string;
  readonly path: Path;
  readonly label: string;
  /** The case whose document carries the leaf, when not `constraint <leaf> pattern`. */
  readonly source?: string;
  /** What `path` is set to, when not BAD itself (a struct holding the leaf). */
  readonly value?: unknown;
}> = [
  { format: "acceptance-request", leaf: "phase", path: ["phase"], label: "PhaseId" },
  { format: "acceptance-request", leaf: "base", path: ["base"], label: "CommitSha" },
  { format: "gate-request", leaf: "phases[].id", path: ["phases", 0, "id"], label: "PhaseId" },
  {
    format: "first-reading",
    leaf: "copiedBy[].phase",
    path: ["copiedBy", 0, "phase"],
    label: "PhaseId",
  },
  { format: "interactive-session", leaf: "phaseId", path: ["phaseId"], label: "PhaseId" },
  {
    format: "interactive-session",
    leaf: "transcripts[].sha256",
    path: ["transcripts", 0, "sha256"],
    label: "Sha256",
  },
  {
    format: "interactive-session",
    leaf: "transcripts[].sessionId",
    path: ["transcripts", 0, "sessionId"],
    label: "SafeSessionId",
  },
  { format: "review-stop", leaf: "phase.id", path: ["phase", "id"], label: "PhaseId" },
  {
    format: "run-status",
    leaf: "hold.phases[]",
    path: ["hold", "phases", 0],
    label: "PhaseId",
    source: "accepts a document setting every field",
  },
  { format: "phase-status", leaf: "base", path: ["base"], label: "CommitSha" },
  {
    format: "decision-record-manifest",
    leaf: "decisionId",
    path: ["decisionId"],
    label: "DecisionId",
  },
  {
    format: "decision-record-manifest",
    leaf: "doctrine[].fingerprint",
    path: ["doctrine", 0, "fingerprint"],
    label: "Sha256",
  },
  {
    format: "revision-record-manifest",
    leaf: "revisionId",
    path: ["revisionId"],
    label: "RevisionId",
  },
  { format: "finding-fate-record-manifest", leaf: "commit", path: ["commit"], label: "CommitSha" },
  {
    format: "finding-fate-record-manifest",
    leaf: "by.grant",
    path: ["by", "grant"],
    label: "Grant",
    source: "accepts a fix by a machine",
  },
  {
    format: "plan-approval-record",
    leaf: "code.baseline",
    path: ["code", "baseline"],
    label: "CommitSha",
    source: "accepts a document with a code baseline",
  },
  {
    format: "spec-approval-record",
    leaf: "approvedBy.grant",
    path: ["approvedBy", "grant"],
    label: "Grant",
    source: "accepts a document setting every field",
  },
  {
    format: "spec-document",
    leaf: "openQuestions[].id",
    path: ["openQuestions", 0, "id"],
    label: "QuestionId",
  },
  {
    format: "spec-hand-decision-answer",
    leaf: "decisions[].id",
    path: ["decisions", 0, "id"],
    label: "QuestionId",
  },
  {
    format: "plan-hand-decision-answer",
    leaf: "decisions[].verdict.phase",
    path: ["decisions", 0, "verdict", "phase"],
    label: "PhaseId",
  },
  {
    format: "phax-plan",
    leaf: "phases[].id",
    path: ["phases", 0, "id"],
    label: "PhaseId",
    source: "accepts a document setting every field, declaring the gate profile light",
  },
  {
    format: "phase-record-manifest",
    leaf: "acceptance.passedBy",
    path: ["acceptance", "passedBy"],
    label: "PhaseId",
    source: "accepts a next-shaped document setting every field",
  },
  {
    format: "phase-record-manifest",
    leaf: "stop.sessions[].sessionId",
    path: ["stop", "sessions", 0, "sessionId"],
    label: "SafeSessionId",
    source: "accepts a next-shaped document setting every field",
  },
  {
    format: "phase-record-manifest",
    leaf: "stop.sessions[].transcript.sha256",
    path: ["stop", "sessions", 0, "transcript"],
    label: "Sha256",
    source: "accepts a next-shaped document setting every field",
    value: { status: "captured", sha256: BAD },
  },
  { format: "plan-approval-record", leaf: "baseline", path: ["baseline"], label: "CommitSha" },
  { format: "spec-approval-record", leaf: "baseline", path: ["baseline"], label: "CommitSha" },
  {
    format: "decide-verdicts",
    leaf: "verdicts[].question",
    path: ["verdicts", 0, "question"],
    label: "QuestionId",
  },
];

describe("identifier-like leaves name their label in a refusal", () => {
  it.each(rows)(
    "$format $leaf: Expected $label",
    ({ format, leaf, path, label, source, value }) => {
      const caseName = source ?? `constraint ${leaf} pattern`;
      const document = documentWithBadLeaf(format, caseName, path, value ?? BAD);
      const answer = replay(`format:${format}`, document);
      expect(answer.ok).toBe(false);
      const refusal = answer.ok ? "" : answer.refusal;
      expect(refusal).toContain(`Expected ${label}, actual "${BAD}"`);
      expect(refusal).not.toContain("matching the pattern");
    },
  );

  it("a phase agent binding's phaseId: Expected PhaseId", () => {
    const decoded = decodePhaseAgentBinding({
      version: 1,
      shortName: "garden-sync",
      runId: "2611011300-garden-sync",
      phaseId: BAD,
      phaseIndex: 0,
      phaseName: "One",
      provider: "claude",
      adapter: "claude",
      model: "claude-opus-5-5",
      effort: "medium",
      sessionId: null,
      sessionHandle: null,
      worktreePath: "/tmp/w",
      cwd: "/tmp/w",
      launchedAt: "2026-11-01T13:30:00Z",
      status: "running",
    });
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      expect(firstRefusal(decoded.failure)).toMatchObject({
        path: ["phaseId"],
        expected: "PhaseId",
      });
    }
  });

  // A finding id keeps its own refusal text (`refusalOverride`); its label is FindingId.
  it.each([
    { name: "code review", schema: CodeReviewFindingIdSchema },
    { name: "compliance review", schema: ComplianceFindingIdSchema },
  ])("a $name finding id is labelled FindingId", ({ schema }) => {
    const decoded = Schema.decodeUnknownResult(schema, { reportInput: true })(BAD);
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      expect(firstRefusal(decoded.failure)).toMatchObject({ expected: "FindingId", actual: BAD });
    }
  });

  it("a finding fate record's finding is labelled FindingId", () => {
    const document = documentWithBadLeaf(
      "finding-fate-record-manifest",
      "accepts a fix by an operator",
      ["finding"],
      BAD,
    );
    const decoded = decodeFindingFateRecordManifestFile(document);
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      expect(firstRefusal(decoded.failure)).toMatchObject({
        path: ["finding"],
        expected: "FindingId",
        actual: BAD,
      });
    }
  });
});
