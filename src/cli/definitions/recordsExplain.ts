// `phax records explain <sha>` as the runner reads it: a commit explained from its record. The
// answer is the record's facts by kind (a phase, a headless authoring session, a decide session,
// a run-level review entry, or records not configured) with the text of each artifact a flag asks
// for, `null` when the record does not carry it; today's text is rendered from those facts alone.
// A commit that is not found, that no phax phase produced, or whose record is not found is a
// declared error, exit 1, with today's sentence.
import { Data, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import {
  briefArtifactsInOrder,
  explainRecord,
  gateArtifactsInOrder,
  type ExplainedAuthoringRecord,
  type ExplainedDecisionRecord,
  type ExplainedRecord,
} from "../../app/recordsExplain.js";
import { recordsClonePath } from "../../app/recordsSync.js";
import { NodeGitLayer } from "../../infra/git.js";
import { NodeShellLayer } from "../../infra/shell.js";
import {
  RecordAcceptanceRoleSchema,
  RecordStopSchema,
  TokenUsageSchema,
} from "../../schemas/runRecord.js";
import { AuthoringRecordOutcomeSchema } from "../../schemas/authoringRecord.js";
import { DecisionRecordOutcomeSchema } from "../../schemas/decisionRecord.js";
import { ReviewRecordKindSchema } from "../../schemas/reviewRecord.js";
import { ProviderIdSchema } from "../../schemas/providerId.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { configured, exposeMessage, MessageFields } from "./shared.js";

const DISABLED_TEXT = "Records are not configured for this project. Run `phax records init` first.";

/** The commit is none of this repository's. */
class CommitNotFoundError extends Data.TaggedError("CommitNotFoundError")<{
  readonly message: string;
}> {}

/** The commit carries no trailer a phax session leaves. */
class NotPhaxCommitError extends Data.TaggedError("NotPhaxCommitError")<{
  readonly message: string;
}> {}

/** The commit names a record that is not on the records branch. */
class RecordNotFoundError extends Data.TaggedError("RecordNotFoundError")<{
  readonly message: string;
}> {}

const Shape = Schema.Literal("full", "skeleton");
const Text = Schema.NullOr(Schema.String);
const NamedText = Schema.Struct({ name: Schema.String, text: Schema.String });

/** The artifacts a flag asked for, by flag, as text. A flag not given has no key. */
const optional = <S extends Schema.Schema.Any>(schema: S) => Schema.optionalKey(schema);

const PhaseRequested = Schema.Struct({
  prompt: optional(Text),
  diff: optional(Text),
  transcript: optional(Text),
  gates: optional(Schema.Array(NamedText)),
  briefs: optional(Schema.Array(NamedText)),
});

/** An authoring or decision record carries no gate logs and no provider briefs: asked for, the
 *  answer is `null`. */
const SessionRequested = Schema.Struct({
  prompt: optional(Text),
  diff: optional(Text),
  transcript: optional(Text),
  gates: optional(Schema.Null),
  briefs: optional(Schema.Null),
});

const DiffStat = Schema.Struct({
  files: Schema.Number,
  insertions: Schema.Number,
  deletions: Schema.Number,
});

const AcceptanceStep = Schema.Struct({ command: Schema.String, result: Schema.String });

const PhaseExplained = Schema.Struct({
  kind: Schema.Literal("phase"),
  runId: Schema.String,
  phaseId: Schema.String,
  provider: ProviderIdSchema,
  model: Schema.String,
  effort: Schema.String,
  /** Whether the commit explained is the phase's own or a held phase's review commit. */
  addressedBy: Schema.Literal("phase-commit", "review-commit"),
  stop: RecordStopSchema,
  shape: Shape,
  /** The size of the transcript the record carries, 0 when it carries none. */
  transcriptBytes: Schema.Number,
  usage: TokenUsageSchema,
  outcome: Schema.Literal("committed", "failed", "abandoned", "interrupted"),
  checksAttemptCount: Schema.Number,
  verifiedSurfaces: Schema.Array(Schema.String),
  acceptance: RecordAcceptanceRoleSchema,
  acceptanceStep: Schema.NullOr(AcceptanceStep),
  sourceSha: Text,
  sourceReachable: Schema.Boolean,
  promptBytes: Schema.NullOr(Schema.Number),
  diffStat: Schema.NullOr(DiffStat),
  handoffPresent: Schema.Boolean,
  /** How many brief records the record carries. */
  briefCount: Schema.Number,
  requested: PhaseRequested,
});

const AuthoringExplained = Schema.Struct({
  kind: Schema.Literal("authoring"),
  authoringId: Schema.String,
  provider: ProviderIdSchema,
  model: Schema.String,
  effort: Schema.String,
  artifact: Schema.String,
  artifactKind: Schema.Literal("spec", "plan"),
  shape: Shape,
  transcriptBytes: Schema.Number,
  usage: TokenUsageSchema,
  outcome: AuthoringRecordOutcomeSchema,
  sourceSha: Text,
  sourceReachable: Schema.Boolean,
  briefBytes: Schema.NullOr(Schema.Number),
  promptBytes: Schema.NullOr(Schema.Number),
  documentPresent: Schema.Boolean,
  requested: SessionRequested,
});

const Doctrine = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("skill"),
    name: Schema.String,
    source: Schema.Literal("bundled", "project"),
    fingerprint: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("file"),
    path: Schema.String,
    fingerprint: Schema.String,
  }),
);

const DecisionExplained = Schema.Struct({
  kind: Schema.Literal("decision"),
  decisionId: Schema.String,
  provider: ProviderIdSchema,
  model: Schema.String,
  effort: Schema.String,
  artifact: Schema.String,
  artifactKind: Schema.Literal("spec", "plan"),
  mode: Schema.Literal("interactive", "verdicts"),
  session: Schema.Literal("new", "resumed-authoring"),
  shape: Shape,
  transcriptBytes: Schema.Number,
  usage: TokenUsageSchema,
  outcome: DecisionRecordOutcomeSchema,
  /** The decide commit, null when none landed. */
  commit: Text,
  sourceSha: Schema.String,
  sourceReachable: Schema.Boolean,
  questions: Schema.Array(Schema.String),
  arbitrated: Schema.Number,
  departed: Schema.Number,
  doctrine: Schema.Array(Doctrine),
  /** Which of the record's three documents it carries. */
  carries: Schema.Struct({
    prompt: Schema.Boolean,
    document: Schema.Boolean,
    diff: Schema.Boolean,
  }),
  /** The record's file names. */
  files: Schema.Array(Schema.String),
  requested: SessionRequested,
});

/** The answer of `phax records explain`. */
const ExplainOutput = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("records-disabled") }),
  Schema.Struct({
    kind: Schema.Literal("review-entry"),
    resolvedSha: Schema.String,
    runId: Schema.String,
    review: ReviewRecordKindSchema,
    /** Where the review's file sits in that commit's tree. */
    path: Schema.String,
  }),
  PhaseExplained,
  AuthoringExplained,
  DecisionExplained,
);

const ExplainArgs = Schema.Tuple(
  Schema.String.annotations({
    identifier: "sha",
    description: "Commit sha in the source repository (a phase commit or an artifact commit)",
  }),
);

const ExplainFlags = Schema.Struct({
  prompt: optional(Schema.Boolean.annotations({ description: "Print the full prompt" })),
  diff: optional(Schema.Boolean.annotations({ description: "Print the full diff" })),
  transcript: optional(Schema.Boolean.annotations({ description: "Print the full transcript" })),
  gates: optional(
    Schema.Boolean.annotations({
      description: "Print the gate check logs, each followed by its gate request",
    }),
  ),
  briefs: optional(
    Schema.Boolean.annotations({
      description: "Print the phase's brief records (brief-NN.json) in number order",
    }),
  ),
});

type Explained = typeof ExplainOutput.Type;
type PhaseFacts = typeof PhaseExplained.Type;
type AuthoringFacts = typeof AuthoringExplained.Type;
type DecisionFacts = typeof DecisionExplained.Type;
type Flags = typeof ExplainFlags.Type;

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const textOf = (bytes: Uint8Array | undefined): string | null =>
  bytes === undefined ? null : decode(bytes);
const named = (
  entries: ReadonlyArray<readonly [string, Uint8Array]>,
): ReadonlyArray<{ readonly name: string; readonly text: string }> =>
  entries.map(([name, bytes]) => ({ name, text: decode(bytes) }));

/** The text of the prompt, diff and transcript a flag asked for, from the record's artifacts. */
function requestedDocuments(
  artifacts: ReadonlyMap<string, Uint8Array>,
  diffName: string,
  flags: Flags,
) {
  return {
    ...(flags.prompt === true ? { prompt: textOf(artifacts.get("prompt.md")) } : {}),
    ...(flags.diff === true ? { diff: textOf(artifacts.get(diffName)) } : {}),
    ...(flags.transcript === true ? { transcript: textOf(artifacts.get("output.jsonl")) } : {}),
  };
}

function phaseFacts(record: ExplainedRecord, flags: Flags): PhaseFacts {
  const { manifest, artifacts } = record;
  const briefs = briefArtifactsInOrder(artifacts);
  return {
    kind: "phase",
    runId: record.runId,
    phaseId: record.phaseId,
    provider: manifest.provider,
    model: manifest.model,
    effort: manifest.effort,
    addressedBy: record.addressedBy,
    stop: manifest.stop,
    shape: manifest.shape,
    transcriptBytes: artifacts.get("output.jsonl")?.length ?? 0,
    usage: manifest.usage,
    outcome: manifest.outcome,
    checksAttemptCount: record.checksAttemptCount,
    verifiedSurfaces: manifest.verifiedSurfaces,
    acceptance: manifest.acceptance,
    acceptanceStep: record.acceptanceStep,
    sourceSha: manifest.sourceSha ?? null,
    sourceReachable: record.sourceCommitReachable === true,
    promptBytes: record.promptByteLength ?? null,
    diffStat:
      record.diffStat === undefined
        ? null
        : {
            files: record.diffStat.files,
            insertions: record.diffStat.insertions,
            deletions: record.diffStat.deletions,
          },
    handoffPresent: record.handoffPresent,
    briefCount: briefs.length,
    requested: {
      ...requestedDocuments(artifacts, "diff.patch", flags),
      ...(flags.gates === true ? { gates: named(gateArtifactsInOrder(artifacts)) } : {}),
      ...(flags.briefs === true ? { briefs: named(briefs) } : {}),
    },
  };
}

function authoringFacts(record: ExplainedAuthoringRecord, flags: Flags): AuthoringFacts {
  const { manifest, artifacts } = record;
  return {
    kind: "authoring",
    authoringId: record.authoringId,
    provider: manifest.provider,
    model: manifest.model,
    effort: manifest.effort,
    artifact: manifest.artifact,
    artifactKind: manifest.artifactKind,
    shape: manifest.shape,
    transcriptBytes: artifacts.get("output.jsonl")?.length ?? 0,
    usage: manifest.usage,
    outcome: manifest.outcome,
    sourceSha: manifest.sourceSha ?? null,
    sourceReachable: record.sourceCommitReachable === true,
    briefBytes: record.briefByteLength ?? null,
    promptBytes: record.promptByteLength ?? null,
    documentPresent: record.documentPresent,
    requested: {
      ...requestedDocuments(artifacts, "diff.patch", flags),
      ...(flags.gates === true ? { gates: null } : {}),
      ...(flags.briefs === true ? { briefs: null } : {}),
    },
  };
}

function decisionFacts(record: ExplainedDecisionRecord, flags: Flags): DecisionFacts {
  const { manifest, artifacts } = record;
  return {
    kind: "decision",
    decisionId: record.decisionId,
    provider: manifest.provider,
    model: manifest.model,
    effort: manifest.effort,
    artifact: manifest.artifact,
    artifactKind: manifest.artifactKind,
    mode: manifest.mode,
    session: manifest.session,
    shape: manifest.shape,
    transcriptBytes: artifacts.get("output.jsonl")?.length ?? 0,
    usage: manifest.usage,
    outcome: manifest.outcome,
    commit: manifest.commit,
    sourceSha: manifest.sourceSha,
    sourceReachable: record.sourceCommitReachable === true,
    questions: manifest.questions,
    arbitrated: manifest.arbitrated,
    departed: manifest.departed,
    doctrine: manifest.doctrine.map((source) =>
      source.kind === "skill"
        ? {
            kind: "skill" as const,
            name: source.name,
            source: source.source,
            fingerprint: source.fingerprint,
          }
        : { kind: "file" as const, path: source.path, fingerprint: source.fingerprint },
    ),
    carries: {
      prompt: artifacts.has("prompt.md"),
      document: artifacts.has("document.json"),
      diff: artifacts.has("body.diff"),
    },
    files: record.files,
    requested: {
      ...requestedDocuments(artifacts, "body.diff", flags),
      ...(flags.gates === true ? { gates: null } : {}),
      ...(flags.briefs === true ? { briefs: null } : {}),
    },
  };
}

// ── The renders: today's text, from the facts alone ─────────────────────────────

function formatBytes(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  return `${(byteLength / 1024).toFixed(1)} KB`;
}

const shortSha = (sha: string): string => sha.slice(0, 7);

function shapeAndUsageLabel(facts: {
  readonly shape: "full" | "skeleton";
  readonly transcriptBytes: number;
  readonly usage: PhaseFacts["usage"];
}): string {
  const shapeLabel =
    facts.shape === "full"
      ? `full (transcript ${formatBytes(facts.transcriptBytes)})`
      : "skeleton (no transcript)";
  const usageLabel = facts.usage.available
    ? `tokens ${facts.usage.usage.inputTokens.toLocaleString()} in / ${facts.usage.usage.outputTokens.toLocaleString()} out`
    : "tokens unavailable";
  return `${shapeLabel}   ${usageLabel}`;
}

const sizeLabel = (byteLength: number | null): string =>
  byteLength !== null ? `${byteLength} bytes` : "absent";

const reachability = (reachable: boolean): string =>
  reachable ? "reachable" : "not reachable — rebased or squashed";

/** One artifact a flag asked for, or the line that says the record does not carry it. */
function artifactLine(name: string, text: string | null | undefined): string[] {
  if (text === undefined) return [];
  return [text === null ? `(${name} not present in this record)` : text];
}

/**
 * The lines a stopped phase's record adds after its first line: the stop's
 * cause, outcome and closer, then its recorded sessions with their transcripts'
 * digests. A phase that never stopped adds none.
 */
function stopLines(facts: PhaseFacts): string[] {
  const { stop } = facts;
  if (stop === null) return [];
  const verdict = stop.outcome === "corrected" ? "corrected" : "reviewed without change";
  const head =
    stop.cause === "held"
      ? `  held: ${verdict} by ${stop.closedBy.name} — phase commit ${shortSha(facts.sourceSha ?? "")}${
          "reviewCommit" in stop ? `, review commit ${shortSha(stop.reviewCommit)}` : ""
        }`
      : `  interactive: ${verdict} by ${stop.closedBy.name}`;
  const sessions =
    stop.sessions.length === 0
      ? ["  sessions: none"]
      : stop.sessions.map((s) => {
          const transcript =
            s.transcript.status === "captured"
              ? `transcript sha256 ${s.transcript.sha256.slice(0, 4)}…`
              : `transcript missing: ${s.transcript.reason}`;
          return `  sessions: ${s.provider} ${s.model} ${s.sessionId} (${s.origin}; ${transcript})`;
        });
  return [head, ...sessions];
}

function renderPhase(facts: PhaseFacts): string[] {
  const { stop } = facts;
  const foundFrom =
    facts.addressedBy === "review-commit"
      ? ` · found from review commit${stop?.cause === "held" && "reviewCommit" in stop ? ` ${shortSha(stop.reviewCommit)}` : ""}`
      : "";
  const lines = [
    `${facts.phaseId} · ${facts.provider} (${facts.model}, ${facts.effort})${foundFrom}`,
    ...stopLines(facts),
    `run      ${facts.runId}`,
    `record   ${shapeAndUsageLabel(facts)}`,
  ];

  const surfacesLabel =
    facts.verifiedSurfaces.length > 0 ? facts.verifiedSurfaces.join(", ") : "(none)";
  lines.push(
    `gates    ${facts.outcome} after ${facts.checksAttemptCount} attempt(s)   surfaces  ${surfacesLabel}`,
  );

  if (facts.acceptance !== null) {
    const role =
      facts.acceptance.role === "acceptance"
        ? `acceptance phase, passed by ${facts.acceptance.passedBy}`
        : `passes ${facts.acceptance.acceptancePhase}`;
    const step =
      facts.acceptanceStep === null
        ? "not run"
        : `${facts.acceptanceStep.command}: ${facts.acceptanceStep.result}`;
    lines.push(`acceptance   ${role} — ${step}`);
  }

  lines.push(
    facts.sourceSha !== null
      ? `source   ${facts.sourceSha} (${reachability(facts.sourceReachable)})`
      : "source   (none — phase did not commit)",
  );

  const diffLabel =
    facts.diffStat !== null
      ? `${facts.diffStat.files} files, +${facts.diffStat.insertions} -${facts.diffStat.deletions}`
      : "absent";
  lines.push(
    `prompt   ${sizeLabel(facts.promptBytes)}   diff  ${diffLabel}   handoff  ${facts.handoffPresent ? "present" : "absent"}`,
  );
  if (facts.briefCount > 0) lines.push(`briefs   ${facts.briefCount} (--briefs prints them)`);

  const { requested } = facts;
  lines.push(...artifactLine("prompt.md", requested.prompt));
  lines.push(...artifactLine("diff.patch", requested.diff));
  lines.push(...artifactLine("output.jsonl", requested.transcript));
  for (const gate of requested.gates ?? []) lines.push(`--- ${gate.name} ---`, gate.text);
  if (requested.briefs !== undefined) {
    if (requested.briefs.length === 0) lines.push("(no brief records in this record)");
    for (const brief of requested.briefs) lines.push(`--- ${brief.name} ---`, brief.text);
  }
  return lines;
}

function renderAuthoring(facts: AuthoringFacts): string[] {
  const lines = [
    `authoring ${facts.authoringId} · ${facts.provider} (${facts.model}, ${facts.effort})`,
    `artifact ${facts.artifact} (${facts.artifactKind})`,
    `record   ${shapeAndUsageLabel(facts)}`,
    `outcome  ${facts.outcome}`,
    facts.sourceSha !== null
      ? `source   ${facts.sourceSha} (${reachability(facts.sourceReachable)})`
      : "source   (none — session did not commit)",
    `brief    ${sizeLabel(facts.briefBytes)}   prompt  ${sizeLabel(facts.promptBytes)}   document  ${facts.documentPresent ? "present" : "absent"}`,
  ];
  const { requested } = facts;
  lines.push(...artifactLine("prompt.md", requested.prompt));
  lines.push(...artifactLine("diff.patch", requested.diff));
  lines.push(...artifactLine("output.jsonl", requested.transcript));
  if (requested.gates !== undefined) lines.push("(an authoring record carries no gate logs)");
  if (requested.briefs !== undefined)
    lines.push("(an authoring record carries no provider briefs)");
  return lines;
}

function renderDecision(facts: DecisionFacts): string[] {
  const key = `decision/${facts.decisionId}`;
  const filePath = (name: string, carried: boolean): string =>
    carried ? `${key}/${name}` : "absent";
  const lines = [
    `decision ${facts.decisionId} · ${facts.provider} (${facts.model}, ${facts.effort})`,
    `artifact ${facts.artifact} (${facts.artifactKind})`,
    `session  ${facts.mode}, ${facts.session}`,
    `record   ${shapeAndUsageLabel(facts)}`,
    `outcome  ${facts.outcome}${facts.commit === null ? "" : `   commit  ${facts.commit}`}`,
    `source   ${facts.sourceSha} (${reachability(facts.sourceReachable)})`,
    `questions ${facts.questions.join(", ")}   arbitrated: ${facts.arbitrated}   departed: ${facts.departed}`,
    ...facts.doctrine.map((source) =>
      source.kind === "skill"
        ? `doctrine skill ${source.name} (${source.source})   ${source.fingerprint}`
        : `doctrine file ${source.path}   ${source.fingerprint}`,
    ),
    `prompt   ${filePath("prompt.md", facts.carries.prompt)}   document  ${filePath("document.json", facts.carries.document)}   diff  ${filePath("body.diff", facts.carries.diff)}`,
    `files    ${facts.files.join(", ")}`,
  ];
  const { requested } = facts;
  lines.push(...artifactLine("prompt.md", requested.prompt));
  lines.push(...artifactLine("body.diff", requested.diff));
  lines.push(...artifactLine("output.jsonl", requested.transcript));
  if (requested.gates !== undefined) lines.push("(a decision record carries no gate logs)");
  if (requested.briefs !== undefined) lines.push("(a decision record carries no provider briefs)");
  return lines;
}

function renderExplained(value: Explained): string {
  switch (value.kind) {
    case "records-disabled":
      return DISABLED_TEXT;
    case "review-entry":
      return `Commit "${value.resolvedSha.slice(0, 8)}" is the ${value.review} entry of run ${value.runId} on phax/records/v1, not a source commit. Read it with: git show ${value.resolvedSha.slice(0, 8)}:${value.path}`;
    case "phase":
      return renderPhase(value).join("\n");
    case "authoring":
      return renderAuthoring(value).join("\n");
    case "decision":
      return renderDecision(value).join("\n");
  }
}

export const recordsExplainCommand = defineCommand({
  name: "explain",
  summary:
    "Explain a commit from its record: prompt, diff, gates and verified surfaces, handoff, transcript, usage — or, for a headless artifact commit, its authoring record",
  help: "Explains a commit from its record. The commit is a phase commit, a declared interactive phase's commit (Phase-Id with Interactive-Phase), or a held phase's review commit, which carries Run-Id and Held-Phase and resolves to the held phase's record. The output adds the stop's lines: its mode, cause, outcome, the person who closed it, the review commit, and each recorded session with its provider, model, origin and its transcript's sha256, or the reason it is missing. A stop's record never carries the transcript itself: interactive transcripts stay in the run folder whatever records.transcript says.\n\nA run-level review entry's own commit on phax/records/v1 (Run-Id and Review trailers) is a record, not a source commit: explain names the run and the review and prints the git show that reads the review's file, and exits 0.",
  examples: ["phax records explain 3f9c2a1", "phax records explain 3f9c2a1 --gates"],
  input: { args: reject(ExplainArgs), flags: reject(ExplainFlags) },
  output: reject(ExplainOutput),
  run: ({ input }) =>
    Effect.gen(function* () {
      const config = yield* configured();
      const clonePath =
        config.records.destination.kind === "repo"
          ? recordsClonePath(config.stateRoot, config.namespace)
          : undefined;
      const outcome = yield* explainRecord({
        sha: input.args[0],
        repoRoot: config.repoRoot,
        records: config.records,
        publishRemote: config.publish.remote,
        ...(clonePath !== undefined ? { recordsClonePath: clonePath } : {}),
      }).pipe(Effect.provide(Layer.mergeAll(NodeGitLayer, NodeShellLayer)));

      switch (outcome.kind) {
        case "records-disabled":
          return { kind: "records-disabled" } as const;
        case "commit-not-found":
          return yield* Effect.fail(
            new CommitNotFoundError({
              message: `Commit "${outcome.sha}" was not found in this repository.`,
            }),
          );
        case "review-entry":
          return {
            kind: "review-entry",
            resolvedSha: outcome.resolvedSha,
            runId: outcome.runId,
            review: outcome.review,
            path: outcome.path,
          } as const;
        case "not-phax-commit":
          return yield* Effect.fail(
            new NotPhaxCommitError({
              message: `Commit "${outcome.sha}" was not produced by a phax phase, a headless authoring session or a decide session (no Run-Id with Phase-Id or Held-Phase, Authoring-Id or Decision-Id trailers).`,
            }),
          );
        case "not-found":
          return yield* Effect.fail(
            new RecordNotFoundError({
              message: outcome.remoteConsulted
                ? `No record found for ${outcome.key} (checked local and remote).`
                : "No record found locally; the remote was not consulted (offline).",
            }),
          );
        case "found":
          return phaseFacts(outcome.record, input.flags);
        case "found-authoring":
          return authoringFacts(outcome.record, input.flags);
        case "found-decision":
          return decisionFacts(outcome.record, input.flags);
      }
    }).pipe(Effect.mapError(exposeMessage)),
  exits: {
    ConfigValidationError: 2,
    GitError: 1,
    ShellError: 1,
    CommitNotFoundError: 1,
    NotPhaxCommitError: 1,
    RecordNotFoundError: 1,
  },
  errors: {
    ConfigValidationError: MessageFields,
    GitError: MessageFields,
    ShellError: MessageFields,
    CommitNotFoundError: MessageFields,
    NotPhaxCommitError: MessageFields,
    RecordNotFoundError: MessageFields,
  },
  texts: {
    ConfigValidationError: (error) => error.message,
    GitError: (error) => error.message,
    ShellError: (error) => error.message,
    CommitNotFoundError: (error) => error.message,
    NotPhaxCommitError: (error) => error.message,
    RecordNotFoundError: (error) => error.message,
  },
  render: renderExplained,
});
