// `phax artifact revise <path> --amendment <file|->` as the runner reads it. The runner reads the
// amendment from the file named or from stdin (`-`) as text and refuses an empty one with exit 64
// before anything runs. One headless writer session returns the whole revised document, and the
// command answers the report object, then the files its commit holds and the revision record's
// outcome. The session's progress lines are said on stdout as they happen (note lines under
// `--json`); its warnings are progress lines, and the record's and push's warnings notes. Revise
// never prompts: it commits without asking.
import { join } from "node:path";
import { Effect, Result, Layer } from "effect";
import * as Schema from "effect/Schema";
import { loadConfig } from "../../app/loadConfig.js";
import { loadModelRouting, loadProviderConfig } from "../../app/loadRouting.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { recordsClonePath } from "../../app/recordsSync.js";
import { reviseArtifact } from "../../app/reviseArtifact.js";
import { revisionRecordPushWarning, revisionRecordWarning } from "../../app/writeRevisionRecord.js";
import type { ArtifactKind } from "../../domain/artifact/status.js";
import { AgentInvocationError } from "../../domain/errors.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import { makeNodeSessionLayer } from "../../infra/session.js";
import { NodeTerminalLayer } from "../../infra/terminal.js";
import type { Backend } from "../../ports/backend.js";
import { FileSystem } from "../../ports/fs.js";
import type { GitHub } from "../../ports/github.js";
import type { Session } from "../../ports/session.js";
import type { Terminal } from "../../ports/terminal.js";
import {
  defineCommand,
  reject,
  type StdinDocument,
  Written,
} from "../commandLibrary/contract/index.js";
import { makeProviderBackendLayer, renderAgentInvocationError } from "../commands/runLayers.js";
import {
  isSessionFailureError,
  renderSessionFailure,
  retryCommandLine,
} from "../commands/sessionFailureOutput.js";
import { defaultBundleRoot } from "./skills.js";
import {
  exposeMessage,
  RecordOutcome,
  recordNotes,
  recordOutcome,
  repoPaths,
  sessionCommandErrors,
  sessionCommandExits,
  sessionCommandRefusal,
  sessionCommandTexts,
  sessionFailure,
  writtenRecords,
} from "./shared.js";

/** Layers a test swaps for fakes; each defaults to the real adapter. */
export interface ArtifactReviseDeps {
  readonly backendLayer?: Layer.Layer<Backend>;
  readonly sessionLayer?: Layer.Layer<Session>;
  readonly terminalLayer?: Layer.Layer<Terminal>;
  readonly githubLayer?: Layer.Layer<GitHub>;
}

const SKILL_SOURCE_DIR_FOR_KIND: Readonly<Record<ArtifactKind, string>> = {
  spec: "phax-spec",
  plan: "phax-planning",
};

const PathArg = reject(
  Schema.Tuple([
    Schema.String.annotate({
      identifier: "path",
      description: "Path to a Draft spec or plan under docs/specs/ or docs/plans/",
    }),
  ]),
);

const optional = <S extends Schema.Top>(schema: S) => Schema.optionalKey(schema);

const ReviseFlags = reject(
  Schema.Struct({
    by: optional(
      Schema.String.annotate({
        identifier: "requester",
        description:
          "operator, or machine:<grant>: who asked for the revision; without it the operator when stdin is a terminal",
      }),
    ),
    model: optional(
      Schema.String.annotate({
        identifier: "model",
        description: "Override the writer model (else authoring.<kind>)",
      }),
    ),
    effort: optional(
      Schema.String.annotate({
        identifier: "effort",
        description: "Override the writer effort: low, medium or high",
      }),
    ),
  }),
);

/** `--amendment <file|->`: the amendment's text, read by the runner from the file named or from
 *  stdin. An empty or whitespace-only one is refused before anything runs. */
const AmendmentStdin = reject(
  Schema.String.check(Schema.isPattern(/\S/)).annotate({
    identifier: "amendment",
    description: "Path to an amendment file, or - to read the amendment from stdin",
  }),
  { flag: "amendment", text: true, valueRequired: true },
);

const Commit = Schema.Struct({ hash: Schema.String, subject: Schema.String });

const ReviseOutput = Schema.Struct({
  artifact: Schema.String,
  status: Schema.Literal("Draft"),
  session: Schema.Literals(["new", "resumed-authoring"]),
  provider: Schema.String,
  model: Schema.String,
  requestedModel: Schema.String,
  effort: Schema.String,
  newQuestions: Schema.Array(Schema.Struct({ id: Schema.String, question: Schema.String })),
  openQuestions: Schema.Array(Schema.String),
  diff: Schema.String,
  commit: Schema.NullOr(Commit),
  revisionId: Schema.String,
  written: Schema.Array(Written),
  record: RecordOutcome,
});

/** What the report is: the `--json` object, which the text report renders. */
export type ReviseReport = typeof ReviseOutput.Type;

/** The record line of a revise: its key, or off; a warning is a note. */
function recordLine(record: RecordOutcome | null): ReadonlyArray<string> {
  if (record?.kind === "written") return [`record     ${record.key}`];
  if (record?.kind === "off") return ["record     off"];
  return [];
}

/** The report a revise prints, as lines, record line included. */
export function renderReviseReport(answer: ReviseReport): readonly string[] {
  const lines: string[] = [];
  if (answer.newQuestions.length === 0) {
    lines.push("questions  none new");
  } else {
    answer.newQuestions.forEach((q, index) => {
      const head =
        index === 0 ? `questions  ${answer.newQuestions.length} new open: ` : " ".repeat(11);
      lines.push(`${head}${q.id} — ${q.question}`);
    });
  }
  if (answer.diff.trim() !== "") {
    lines.push("--- body diff ---");
    lines.push(answer.diff.replace(/\n+$/, ""));
  }
  if (answer.commit === null) {
    lines.push(`nothing changed: the amendment changed nothing in ${answer.artifact} — no commit`);
  } else {
    lines.push(`commit     ${answer.commit.hash.slice(0, 7)} — ${answer.commit.subject}`);
  }
  // Every question open after the revision is named, the ones it appended first: approve
  // refuses while any is open.
  const added = answer.newQuestions.map((q) => q.id);
  const open = [...added, ...answer.openQuestions.filter((id) => !added.includes(id))];
  const decide =
    open.length > 0
      ? `\`phax artifact decide ${answer.artifact}\` (${open.join(", ")} open), then `
      : "";
  lines.push(
    `status     Draft — read the diff above, then ${decide}\`phax artifact approve ${answer.artifact}\``,
  );
  lines.push(...recordLine(answer.record));
  return lines;
}

const revisionRecordSentences = {
  warningOf: (record: Parameters<typeof revisionRecordWarning>[0]) => revisionRecordWarning(record),
  pushWarningOf: revisionRecordPushWarning,
  fallback: "revision record not written",
} as const;

/** How the amendment reads in a sentence: the path as the call gave it, or `stdin`. */
const labelOf = (document: StdinDocument): string =>
  document.origin.kind === "file" ? document.origin.path : "stdin";

/** The lines of a revise's failure: a failed session's report with its retry, a handback that
 *  could not resume with Claude Code's stderr, else the cause's sentence. */
function causeLines(retry: string): (cause: unknown) => ReadonlyArray<string> {
  return (cause) => {
    if (isSessionFailureError(cause)) return renderSessionFailure(cause, retry);
    if (cause instanceof AgentInvocationError) {
      const { message, logHint } = renderAgentInvocationError(cause);
      return logHint === undefined ? [`✗ ${message}`] : [`✗ ${message}`, `  ${logHint}`];
    }
    return [`✗ ${(cause as { readonly message: string }).message}`];
  };
}

interface ReviseFlagValues {
  readonly by?: string;
  readonly model?: string;
  readonly effort?: string;
}

interface ReviseCall {
  readonly pathArg: string;
  readonly flags: ReviseFlagValues;
  readonly amendment: StdinDocument;
  readonly say: (text: string) => Effect.Effect<void>;
  readonly progress: (text: string) => Effect.Effect<void>;
}

function runRevise(call: ReviseCall, deps: ArtifactReviseDeps) {
  return Effect.gen(function* () {
    const { pathArg, flags, amendment } = call;
    const configResult = loadConfig(process.cwd());
    if (Result.isFailure(configResult)) {
      return yield* Effect.fail(
        sessionCommandRefusal(1, `Config error: ${configResult.failure.message}`),
      );
    }
    const config = configResult.success;
    const repoRoot = config.repoRoot;
    const fsLayer = makeRootedNodeFileSystemLayer(repoRoot);
    const providerConfig = yield* Effect.result(loadProviderConfig().pipe(Effect.provide(fsLayer)));
    if (Result.isFailure(providerConfig)) {
      return yield* Effect.fail(
        sessionCommandRefusal(
          1,
          `Failed to load routing config: ${providerConfig.failure.message}`,
        ),
      );
    }
    const layer = Layer.mergeAll(
      fsLayer,
      makeNodeGitLayer(),
      deps.backendLayer ?? makeProviderBackendLayer(providerConfig.success),
      deps.sessionLayer ?? makeNodeSessionLayer(),
      deps.terminalLayer ?? NodeTerminalLayer,
      deps.githubLayer ?? NodeGitHubLayer,
    );
    const output = {
      log: (text: string): void => Effect.runSync(call.say(text)),
      warn: (text: string): void => Effect.runSync(call.progress(text)),
    };
    const source = amendment.origin.kind === "file" ? amendment.origin.path : "-";
    const retry =
      retryCommandLine([
        "artifact",
        "revise",
        pathArg,
        "--amendment",
        source,
        ...(flags.by === undefined ? [] : ["--by", flags.by]),
        ...(flags.model === undefined ? [] : ["--model", flags.model]),
        ...(flags.effort === undefined ? [] : ["--effort", flags.effort]),
      ]) + (source === "-" ? " (pipe the same amendment again)" : "");

    const revised = yield* Effect.result(
      Effect.gen(function* () {
        const routing = yield* loadModelRouting();
        const fs = yield* FileSystem;
        const skillText = (kind: ArtifactKind) =>
          fs.readText(join(defaultBundleRoot(), SKILL_SOURCE_DIR_FOR_KIND[kind], "SKILL.md"));
        const skills = { spec: yield* skillText("spec"), plan: yield* skillText("plan") };
        return yield* reviseArtifact({
          path: repoPaths(pathArg, repoRoot).repoRelPath,
          amendment: { text: amendment.text, label: labelOf(amendment) },
          by: flags.by,
          model: flags.model,
          effort: flags.effort,
          authoring: { spec: config.authoring.spec, plan: config.authoring.plan },
          routing,
          providerConfig: providerConfig.success,
          skills,
          security: config.security,
          repoRoot,
          stateRoot: effectiveStateRoot(config),
          extractPlanModel: config.extractPlanModel,
          extractPlanEffort: config.extractPlanEffort,
          nowIso: new Date().toISOString(),
          records: config.records,
          publishRemote: config.publish.remote,
          ...(config.records.destination.kind === "repo"
            ? { recordsClonePath: recordsClonePath(config.stateRoot, config.namespace) }
            : {}),
          output,
        });
      }).pipe(Effect.provide(layer)),
    );
    if (Result.isFailure(revised)) {
      return yield* Effect.fail(
        yield* sessionFailure(revised.failure, causeLines(retry), repoRoot),
      );
    }
    const result = revised.success;
    const answer: ReviseReport = {
      artifact: result.path,
      status: result.status,
      session: result.session,
      provider: result.provider,
      model: result.model,
      requestedModel: result.requestedModel,
      effort: result.effort,
      newQuestions: result.newQuestions.map((q) => ({ id: q.id, question: q.question })),
      openQuestions: result.openQuestions,
      diff: result.diff,
      commit:
        result.commit === null
          ? null
          : { hash: result.commit.hash, subject: result.commit.subject },
      revisionId: result.revisionId,
      written: yield* writtenRecords(result.paths, repoRoot),
      record: recordOutcome(result.record, result.recordPush, revisionRecordSentences),
    };
    return answer;
  }).pipe(Effect.mapError(exposeMessage));
}

const REVISE_HELP =
  "Revises a Draft spec or plan that was authored headlessly (its JSON sidecar beside the .md, in sync with it) from an amendment: a change request in prose, read from a file or from stdin (-; a terminal on stdin is refused with exit 64, and so is an empty amendment). A hand-authored artifact has no sidecar and is refused: edit it directly.\n\nOne headless writer session returns the whole revised document, carrying the amendment wherever it applies and leaving everything else as it is. It resumes the artifact's kept authoring session when that session ran on the writer's provider in this checkout, and starts a new one otherwise (a new session also gets the kind's authoring skill and the kept brief as background), and says which. The model is --model and --effort, else phax.json's authoring.<kind> (which carries the catalog default when phax.json sets none), routed to a provider like headless authoring: a model with no equivalent on the selected provider runs as the concrete model routing chose, and the report names it beside the requested one. The writer runs read-only on whatever provider routing selects, Mistral Vibe included; no model is refused for its provider. The effort is low, medium or high.\n\nphax checks the answer: the document carries its kind's current `$schema` and decodes, every existing question stays unchanged and in place (an arbitrated question, its verdict and history included, and every open question as it was), and new open questions are only appended, with ids new to the artifact. It asks once more, resuming the same session, when the check fails. The frontmatter is kept byte for byte. When the revised body renders the same as the current one, nothing is written and no commit is made (exit 0, the report says the amendment changed nothing). Otherwise phax writes the .md and its sidecar, re-seeds a plan's extraction cache, and commits both in one commit without asking. The artifact stays Draft: read the body diff, decide every question still open (`phax artifact decide`; the report's status line names them), then approve. The commit body carries the amendment verbatim, followed by the trailers Artifact, Revised-By and Revision-Id.\n\n--by operator | machine:<grant> names who asked for the revision; without it the operator is assumed when stdin is a terminal, and a call without a terminal needs --by. A committing git identity (user.name) is required in every case, since the revision commits.\n\nBefore any session it refuses, writing nothing (exit 12): a live sidecar not yet migrated (`phax artifact migrate-documents`), an artifact that is not Draft (an Approved or Stale one names `phax artifact reopen <path>`), a hand-authored, diverged or invalid sidecar, uncommitted changes on the artifact or its sidecar, an unusable --by, no committing git identity, and a model or effort it cannot use.\n\nWith --json it prints the report as one indented JSON object on stdout (artifact, status, session, provider, model, requestedModel, effort, newQuestions, openQuestions, the ids of every question open after the revision, diff, commit, revisionId, written, the files its commit holds, and record, the revision record's outcome); progress and warnings are note lines on stderr. commit is null when nothing changed.\n\nExit codes: 0 revised and committed, or nothing changed; 1 inside a phase worktree, where the phase guard refuses it; 5 no document, not JSON, an answer not stamped with its current shape, or one refused by the schema or its checks (after the one corrective resume), or a failed agent session, with nothing written; 8 a provider rate or usage limit, with nothing written; 12 a refusal, the artifact changed during the session (its change left in place), or a failed commit (the files left written but uncommitted); 14 the provider unreachable (a network failure), with nothing written; 64 an amendment that cannot be read or is empty, or a terminal on stdin for -, before anything runs.\n\nSide effects: spawns one headless writer session, read-only whatever the security profile; keeps the amendment, prompts, answer, body diff and transcripts under the state root's revise/<authoringId>/<NN>/; on a change, writes the artifact and its sidecar and commits exactly those paths in one commit with a `Revision-Id: <authoringId>/<NN>` trailer. When records are configured, every writer session that ran — committed, unchanged or failed — writes one revision record (key revision/<authoringId>/<NN>) on phax/records/v1, and `phax records explain <commit>` resolves the commit to it.";

export function makeArtifactReviseCommand(deps: ArtifactReviseDeps = {}) {
  return defineCommand({
    name: "revise",
    summary:
      "Revise a Draft headless-authored spec or plan from an amendment, in one writer session",
    help: REVISE_HELP,
    examples: [
      "phax artifact revise docs/plans/2610271402-identity-store-plan.md --amendment amendment.md --by machine:plan-loop",
      "phax artifact revise docs/specs/2610271505-artifact-revise.md --amendment - --by operator --json",
    ],
    input: { args: PathArg, flags: ReviseFlags, stdin: AmendmentStdin },
    output: reject(ReviseOutput),
    run: ({ input, document, say, progress }) =>
      document === undefined
        ? Effect.fail(sessionCommandRefusal(12, "--amendment <file|-> is required"))
        : runRevise(
            { pathArg: input.args[0], flags: input.flags, amendment: document, say, progress },
            deps,
          ),
    exits: sessionCommandExits,
    errors: sessionCommandErrors,
    texts: sessionCommandTexts,
    render: (value) => renderReviseReport(value).join("\n"),
    notes: (value) => recordNotes(value.record),
  });
}
