// `phax artifact decide <path>` as the runner reads it. With `--verdicts <file|->` the runner reads
// the verdicts document from the file named or from stdin (`-`) and decodes it before anything
// runs; the command's check then binds it to the artifact's questions, refusing a file that does
// not fit the artifact (another artifact's path, an unknown question or option, a missing note) at
// its field, before any session. One headless writer session transcribes the verdicts, and the
// command answers today's report object, then the files its commit holds and the decision
// record's outcome. Without `--verdicts` decide opens an interactive session with the operator and
// answers its outcome. The session's progress lines are said on stdout as they happen (note lines
// under `--json`), its warnings are progress lines, and the record's and push's warnings notes. A
// call that would wait on a person (no `--verdicts`, or no `--by`) is refused under `--json`.
import { join } from "node:path";
import { Effect, Result, Layer } from "effect";
import * as Schema from "effect/Schema";
import { decideArtifact, readArtifact } from "../../app/decideArtifact.js";
import { type DecideVerdictsResult, decideVerdicts } from "../../app/decideVerdicts.js";
import { loadConfig } from "../../app/loadConfig.js";
import { loadModelRouting, loadProviderConfig } from "../../app/loadRouting.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { recordsClonePath } from "../../app/recordsSync.js";
import { decisionRecordPushWarning, decisionRecordWarning } from "../../app/writeDecisionRecord.js";
import { DECIDE_SKILL_FOR_KIND } from "../../domain/decide/doctrine.js";
import {
  bindVerdictsAt,
  questionFactsOfDocument,
  questionFactsOfHand,
  verdictsFieldPath,
  verdictsStampViolation,
} from "../../domain/decide/verdicts.js";
import { AgentInvocationError } from "../../domain/errors.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import { makeClackPromptLayer } from "../../infra/prompt.js";
import { makeNodeSessionLayer } from "../../infra/session.js";
import { NodeTerminalLayer } from "../../infra/terminal.js";
import type { Backend } from "../../ports/backend.js";
import { FileSystem } from "../../ports/fs.js";
import type { GitHub } from "../../ports/github.js";
import type { Prompt } from "../../ports/prompt.js";
import type { Session } from "../../ports/session.js";
import type { Terminal } from "../../ports/terminal.js";
import { DecideVerdictsFileSchema } from "../../schemas/decideVerdicts.js";
import {
  defineCommand,
  reject,
  Refused,
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
export interface ArtifactDecideDeps {
  readonly backendLayer?: Layer.Layer<Backend>;
  readonly sessionLayer?: Layer.Layer<Session>;
  readonly promptLayer?: Layer.Layer<Prompt>;
  readonly terminalLayer?: Layer.Layer<Terminal>;
  readonly githubLayer?: Layer.Layer<GitHub>;
}

const PathArg = reject(
  Schema.Tuple([
    Schema.String.annotate({
      identifier: "path",
      description: "Path to a spec or plan file under docs/specs/ or docs/plans/",
    }),
  ]),
);

const optional = <S extends Schema.Top>(schema: S) => Schema.optionalKey(schema);

const DecideFlags = reject(
  Schema.Struct({
    question: optional(
      Schema.String.annotate({
        identifier: "id",
        description: "Present this question alone: an open one, or re-arbitrate one",
      }),
    ),
    by: optional(
      Schema.String.annotate({
        identifier: "arbiter",
        description:
          "operator: who gave the verdicts; required without a terminal (with --verdicts)",
      }),
    ),
    doctrine: optional(
      Schema.String.annotate({
        identifier: "file",
        description: "Append this doctrine file after the decide skill",
      }),
    ),
    model: optional(
      Schema.String.annotate({
        identifier: "model",
        description: "Override the decide model (interactive: a Claude Code model)",
      }),
    ),
    effort: optional(
      Schema.String.annotate({
        identifier: "effort",
        description: "Override the decide effort",
      }),
    ),
  }),
);

/** `--verdicts <file|->`: a decide-verdicts document, read by the runner from the file named or
 *  from stdin, and decoded before anything runs. */
const VerdictsStdin = reject(
  DecideVerdictsFileSchema.annotate({
    identifier: "decide-verdicts",
    description: "Decide from a verdicts file, or - for stdin, without an interactive session",
  }),
  { flag: "verdicts", valueRequired: true },
);

const Commit = Schema.Struct({ hash: Schema.String, subject: Schema.String });

const VerdictsOutput = Schema.Struct({
  artifact: Schema.String,
  status: Schema.Literal("Draft"),
  session: Schema.Literals(["new", "resumed-authoring"]),
  provider: Schema.String,
  model: Schema.String,
  requestedModel: Schema.String,
  effort: Schema.String,
  verdicts: Schema.Array(
    Schema.Struct({
      question: Schema.String,
      chosen: Schema.String,
      recommendation: Schema.String,
      departs: Schema.Boolean,
      why: Schema.String,
      revised: Schema.Array(Schema.String),
      by: Schema.Struct({ kind: Schema.Literal("operator"), name: Schema.String }),
    }),
  ),
  open: Schema.Array(Schema.String),
  diff: Schema.String,
  commit: Commit,
  decisionId: Schema.String,
  written: Schema.Array(Written),
  record: RecordOutcome,
});

const InteractiveOutput = Schema.Struct({
  kind: Schema.Literals(["nothing", "undecided", "declined", "committed"]),
  path: Schema.String,
  commit: Schema.NullOr(Commit),
  written: Schema.Array(Written),
  record: Schema.NullOr(RecordOutcome),
});

/** What decide answers: the verdicts report, or an interactive session's outcome. */
const DecideOutput = Schema.Union([VerdictsOutput, InteractiveOutput]);

type DecideOutput = typeof DecideOutput.Type;
type VerdictsOutput = typeof VerdictsOutput.Type;

/** What the verdicts report reads: the result of a verdicts-mode decide, or the answer made of it. */
interface VerdictsReport {
  readonly path: string;
  readonly verdicts: ReadonlyArray<{
    readonly question: string;
    readonly chosen: string;
    readonly recommendation: string;
    readonly departs: boolean;
    readonly why: string;
    readonly revised: ReadonlyArray<string>;
  }>;
  readonly open: ReadonlyArray<string>;
  readonly diff: string;
  readonly commit: { readonly hash: string; readonly subject: string };
}

/** The report a verdicts-mode decide prints, as lines (the record line follows it). */
export function renderVerdictsReport(result: VerdictsReport): readonly string[] {
  const ids = [...result.verdicts.map((v) => v.question), ...result.open];
  const idWidth = Math.max(10, ...ids.map((id) => id.length)) + 1;
  const chosenWidth = Math.max(9, ...result.verdicts.map((v) => v.chosen.length)) + 1;
  const lines: string[] = [];
  for (const v of result.verdicts) {
    const outcome = v.departs
      ? `departs from ${v.recommendation} — revised: ${v.revised.join(", ")}`
      : v.revised.length > 0
        ? `(recommended) — revised: ${v.revised.join(", ")}`
        : "(recommended)";
    lines.push(`${v.question.padEnd(idWidth)}${v.chosen.padEnd(chosenWidth)}${outcome}`);
    lines.push(`${" ".repeat(idWidth)}why: ${v.why}`);
  }
  for (const id of result.open) {
    lines.push(`${id.padEnd(idWidth)}${"open".padEnd(chosenWidth)}(not in the verdicts file)`);
  }
  if (result.diff.trim() !== "") lines.push(result.diff.replace(/\n+$/, ""));
  lines.push(`commit     ${result.commit.hash.slice(0, 7)} — ${result.commit.subject}`);
  lines.push(
    `status     Draft — read the verdicts and the diff above, then \`phax artifact approve ${result.path} --by operator\``,
  );
  return lines;
}

/** The report's twelve keys, in today's order, no `$schema`: the answer adds `written` and
 *  `record` after them. */
export function verdictsReportJson(result: DecideVerdictsResult) {
  return {
    artifact: result.path,
    status: result.status,
    session: result.session,
    provider: result.provider,
    model: result.model,
    requestedModel: result.requestedModel,
    effort: result.effort,
    verdicts: result.verdicts.map((v) => ({
      question: v.question,
      chosen: v.chosen,
      recommendation: v.recommendation,
      departs: v.departs,
      why: v.why,
      revised: v.revised,
      by: v.by,
    })),
    open: result.open,
    diff: result.diff,
    commit: { hash: result.commit.hash, subject: result.commit.subject },
    decisionId: result.decisionId,
  };
}

/** The record line of a decide, as today: its key, or off; a warning is a note. */
function recordLine(record: RecordOutcome | null): ReadonlyArray<string> {
  if (record?.kind === "written") return [`record     ${record.key}`];
  if (record?.kind === "off") return ["record     off"];
  return [];
}

/** Today's lines, from the answer alone. */
function renderDecide(value: DecideOutput): string {
  if ("artifact" in value) {
    return [
      ...renderVerdictsReport({ ...value, path: value.artifact }),
      ...recordLine(value.record),
    ].join("\n");
  }
  switch (value.kind) {
    case "nothing":
      return `nothing to decide: ${value.path} has no open question`;
    case "undecided":
      return `nothing decided: the session arbitrated no question — ${value.path} is unchanged`;
    case "declined":
      return "body diff declined — nothing written";
    case "committed":
      return [
        ...(value.commit === null
          ? []
          : [`commit     ${value.commit.hash.slice(0, 7)} — ${value.commit.subject}`]),
        ...recordLine(value.record),
      ].join("\n");
  }
}

/** The record's and its push's warnings; an interactive decide warns only once committed. */
function notesOf(value: DecideOutput): string {
  if ("artifact" in value) return recordNotes(value.record);
  return value.kind === "committed" && value.record !== null ? recordNotes(value.record) : "";
}

const decisionRecordSentences = {
  warningOf: (record: Parameters<typeof decisionRecordWarning>[0]) => decisionRecordWarning(record),
  pushWarningOf: decisionRecordPushWarning,
  fallback: "decision record not written",
} as const;

/** How a verdicts document reads in a sentence: the path as the call gave it, or `stdin`. */
const labelOf = (document: StdinDocument): string =>
  document.origin.kind === "file" ? document.origin.path : "stdin";

/** The lines of a decide's failure, as today: a failed session's report with its retry, a
 *  handback that could not resume with Claude Code's stderr, else the cause's sentence. */
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

interface DecideFlagValues {
  readonly question?: string;
  readonly by?: string;
  readonly doctrine?: string;
  readonly model?: string;
  readonly effort?: string;
}

interface DecideCall {
  readonly pathArg: string;
  readonly flags: DecideFlagValues;
  /** The verdicts document as read, when `--verdicts` was given. */
  readonly verdicts: StdinDocument | undefined;
  readonly say: (text: string) => Effect.Effect<void>;
  readonly progress: (text: string) => Effect.Effect<void>;
}

function runDecide(call: DecideCall, deps: ArtifactDecideDeps) {
  return Effect.gen(function* () {
    const { pathArg, flags, verdicts } = call;
    const flagRefusal =
      verdicts === undefined
        ? flags.by === undefined
          ? null
          : "--by needs --verdicts"
        : flags.question === undefined
          ? null
          : "--question and --verdicts are exclusive — the verdicts file names the questions";
    if (flagRefusal !== null) {
      return yield* Effect.fail(sessionCommandRefusal(12, `✗ ${flagRefusal}`));
    }
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
      deps.promptLayer ?? makeClackPromptLayer(),
      deps.terminalLayer ?? NodeTerminalLayer,
      deps.githubLayer ?? NodeGitHubLayer,
    );
    // The use cases write their lines as they go: on stdout (said), or on stderr (progress).
    const output = {
      log: (text: string): void => Effect.runSync(call.say(text)),
      warn: (text: string): void => Effect.runSync(call.progress(text)),
    };
    const repoRelative = (path: string): string => repoPaths(path, repoRoot).repoRelPath;
    const sharedFlags = [
      ...(flags.doctrine === undefined ? [] : ["--doctrine", flags.doctrine]),
      ...(flags.model === undefined ? [] : ["--model", flags.model]),
      ...(flags.effort === undefined ? [] : ["--effort", flags.effort]),
    ];
    const common = {
      path: repoRelative(pathArg),
      doctrinePath: flags.doctrine === undefined ? null : repoRelative(flags.doctrine),
      model: flags.model,
      effort: flags.effort,
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
    };
    const bundledSkills = Effect.gen(function* () {
      const fs = yield* FileSystem;
      const skillText = (name: string) => fs.readText(join(defaultBundleRoot(), name, "SKILL.md"));
      return {
        spec: yield* skillText(DECIDE_SKILL_FOR_KIND.spec),
        plan: yield* skillText(DECIDE_SKILL_FOR_KIND.plan),
      };
    });

    if (verdicts !== undefined) {
      const label = labelOf(verdicts);
      const source = verdicts.origin.kind === "file" ? verdicts.origin.path : "-";
      const retry =
        retryCommandLine([
          "artifact",
          "decide",
          pathArg,
          "--verdicts",
          source,
          ...(flags.by === undefined ? [] : ["--by", flags.by]),
          ...sharedFlags,
        ]) + (source === "-" ? " (pipe the same verdicts again)" : "");
      const decided = yield* Effect.result(
        Effect.gen(function* () {
          const routing = yield* loadModelRouting();
          return yield* decideVerdicts({
            ...common,
            verdicts: { kind: "read", text: verdicts.text },
            label,
            by: flags.by,
            routing,
            providerConfig: providerConfig.success,
            bundledSkills: yield* bundledSkills,
          });
        }).pipe(Effect.provide(layer)),
      );
      if (Result.isFailure(decided)) {
        return yield* Effect.fail(
          yield* sessionFailure(decided.failure, causeLines(retry), repoRoot),
        );
      }
      const result = decided.success;
      const answer: VerdictsOutput = {
        ...verdictsReportJson(result),
        written: yield* writtenRecords(result.paths, repoRoot),
        record: recordOutcome(result.record, result.recordPush, decisionRecordSentences),
      };
      return answer as DecideOutput;
    }

    const retry = retryCommandLine([
      "artifact",
      "decide",
      pathArg,
      ...(flags.question === undefined ? [] : ["--question", flags.question]),
      ...sharedFlags,
    ]);
    const decided = yield* Effect.result(
      Effect.gen(function* () {
        return yield* decideArtifact({
          ...common,
          question: flags.question ?? null,
          bundledSkills: yield* bundledSkills,
        });
      }).pipe(Effect.provide(layer)),
    );
    if (Result.isFailure(decided)) {
      return yield* Effect.fail(
        yield* sessionFailure(decided.failure, causeLines(retry), repoRoot),
      );
    }
    const result = decided.success;
    const answer: DecideOutput = {
      kind: result.kind,
      path: result.path,
      commit:
        result.kind === "committed"
          ? { hash: result.commit.hash, subject: result.commit.subject }
          : null,
      written: result.kind === "committed" ? yield* writtenRecords(result.paths, repoRoot) : [],
      record:
        result.kind === "nothing"
          ? null
          : recordOutcome(result.record, result.recordPush, decisionRecordSentences),
    };
    return answer;
  }).pipe(Effect.mapError(exposeMessage));
}

/** Decide's check: a verdicts document bound to the artifact's questions, refused at the field
 *  that does not fit it. An artifact that cannot be read passes: `run` refuses it as today. With
 *  `--question` it passes too: `run` refuses the pair first. */
function checkVerdicts(call: {
  readonly pathArg: string;
  readonly question: string | undefined;
  readonly file: typeof DecideVerdictsFileSchema.Type | undefined;
  readonly document: StdinDocument | undefined;
}): Effect.Effect<void, Refused> {
  return Effect.gen(function* () {
    const { file, document } = call;
    if (file === undefined || document === undefined || call.question !== undefined) return;
    // The file's schema accepts every decide-verdicts release: one stamped with an older release
    // is not a verdicts file of this one, refused before anything runs like any file that does
    // not decode.
    const stamp = verdictsStampViolation(file as unknown as Record<string, unknown>);
    if (stamp !== undefined) {
      return yield* Effect.fail(
        new Refused({
          source: "stdin",
          path: ["$schema"],
          expected: "the decide-verdicts schema URL of this release",
          text: `error: ${labelOf(document)}: ${stamp}`,
        }),
      );
    }
    const config = loadConfig(process.cwd());
    if (Result.isFailure(config)) return;
    const repoRoot = config.success.repoRoot;
    const path = repoPaths(call.pathArg, repoRoot).repoRelPath;
    const snapshot = yield* Effect.result(
      readArtifact({ path, repoRoot }).pipe(
        Effect.provide(Layer.merge(makeRootedNodeFileSystemLayer(repoRoot), makeNodeGitLayer())),
      ),
    );
    if (Result.isFailure(snapshot)) return;
    const { authored } = snapshot.success;
    const questions =
      authored.variant === "headless"
        ? questionFactsOfDocument(authored.document)
        : authored.parsed === null
          ? []
          : questionFactsOfHand(authored.parsed);
    const label = labelOf(document);
    const bound = bindVerdictsAt({ file, artifactPath: path, questions, label });
    if (Result.isSuccess(bound)) return;
    const refusal = bound.failure;
    return yield* Effect.fail(
      new Refused({
        source: "stdin",
        path: refusal.path,
        expected: refusal.expected,
        text: `error: ${label}: ${verdictsFieldPath(refusal.path)} ${refusal.problem}`,
      }),
    );
  });
}

const DECIDE_HELP =
  "Decides a Draft spec's or plan's open questions in one of two modes: with the operator in an interactive Claude Code session (the default), or from a verdicts file with --verdicts (below).\n\nIn interactive mode the session first raises the framing questions F1–F5, then presents the open questions in document order; --question <id> presents that question alone, an open one or an arbitrated one to re-arbitrate (its previous verdict is kept in its history). The session follows the doctrine skill for the artifact's kind (phax-decide-spec or phax-decide-plan; a project copy under .claude/skills/ replaces the bundled one), with --doctrine <file> appended after it; a verdict may cite only the backticked ids that open list items in that doctrine. It resumes the artifact's headless authoring session when phax kept its id, and starts a new one otherwise, and says which.\n\nInteractive decide runs on Claude Code only: the model is --model and --effort, else claude-opus-5-5 at high; a model outside the Claude Code catalog, or an effort it does not list, is refused. When the operator exits the session, phax resumes it headless for the revised document — the whole sidecar document of a headless artifact, `$schema` first at its current shape, or its kind's hand decision answer (spec-hand-decision-answer or plan-hand-decision-answer) for a hand-authored one — and asks once more when the answer is refused. phax stamps each verdict with the committing git identity and the time, checks the answer (only presented questions move, others stay as they were, chosen and abandoned name the question's options or the reserved `other`, cited principles are loaded ids, a departing verdict names what it revised), shows the body diff and the verdicts, and writes nothing unless the operator accepts the diff.\n\nBefore any session it refuses, writing nothing: a live sidecar not yet migrated (`phax artifact migrate-documents`), an artifact that is not Draft (an Approved or Stale one names `phax artifact reopen <path>`), a diverged or invalid sidecar, a hand-authored §9 that does not parse (naming its first departing line), uncommitted changes on the artifact or its sidecar, an unknown --question (naming the artifact's question ids), no terminal (interactive mode needs one), a model outside Claude Code (interactive mode), a doctrine file that is unreadable, defines no principle id or redefines a skill id, and no committing git identity. With no open question and no --question it says there is nothing to decide and exits 0. Inside a phase worktree the phase guard refuses it.\n\nExit codes: 0 decided and committed, a declined diff, or nothing to decide; 1 inside a phase worktree; 5 no document, not JSON, an answer not stamped with its current shape, or one refused by the schema or its checks (after the one corrective resume), or a failed agent session, with nothing written; 8 a provider rate or usage limit, with nothing written; 14 the provider unreachable (a network failure), with nothing written; 12 an artifact refusal, the artifact changed during the session (its change left in place), or a failed commit (the files left written but uncommitted).\n\nVerdicts mode: --verdicts <file|-> reads decisions a person has already made, from a file or from a pipe on stdin (-; a terminal on stdin is refused with exit 64), and writes them into the artifact without a prompt. The file is JSON with a `$schema` naming the decide-verdicts format of this release (`phax artifact schema verdicts` prints it), an `artifact` key naming the artifact's repo-relative path, and a non-empty `verdicts` list of { question, chosen, note }: `chosen` is one of the question's option ids or the reserved id `other`, and `note` is the person's reason, a non-empty string or null. A note is required when the verdict departs from the recommendation, `other` included; a null note on a question with an empty rationale is refused, since nothing would stand as its why. Every key is required and unknown keys are refused. Questions the file does not name stay open; an arbitrated question it names is re-arbitrated. No terminal is needed with --by operator, which names the operator as git commits; any other --by, machine:<grant> included, is refused (a verdict always comes from the operator), and without --by a terminal is required. One headless writer session, running under the same doctrine, writes the verdicts into the revised document and revises the body where a departing verdict implies it. It runs on the model --model and --effort name, else claude-sonnet-5-5 at medium, routed to a provider like headless authoring (a model with no equivalent on the selected provider runs as the concrete model routing chose, and the report names it beside the requested one); the writer runs read-only on whatever provider routing selects, Mistral Vibe included. It resumes the kept authoring session when that session ran on the same provider in this checkout, and starts a new one otherwise, and says which. phax refuses a bad file before anything runs, with exit 64 and a refused line naming the file and the field: a file that cannot be read, is not a verdicts file of this release, or does not fit the artifact (another artifact's path, an unknown question or option, a question named twice, a missing note). It checks the writer's answer against the file (each question's options first, then the question set, each chosen and abandoned option, the history, the revised sections, the body outside them; a following verdict revises nothing, except one restoring the recommendation after a departing verdict: it names the sections it restores when that verdict named revised sections, none when it named none, and either when it records none) and asks once more when the check fails, then sets each verdict's why (the note, else the question's rationale), by and at itself. It writes and commits without asking, leaves the artifact Draft, and prints the report to read before approving: each verdict (chosen, followed or departed with the sections revised, and why), the questions left open, the body diff, the commit and the Draft status. With --json it prints that report as one indented JSON object on stdout (artifact, status, session, provider, model, requestedModel, effort, verdicts, open, diff, commit, decisionId, then written, the files its commit holds, and record, the decision record's outcome); progress and warnings are note lines on stderr. The commit subject is as in interactive mode, and its body is followed by the trailers Artifact, Decided-By, Decided-Via: verdicts and Decision-Id; the decision record has mode verdicts. --question is refused with --verdicts, and --by without it, exit 12; --json without --verdicts or without --by is refused with exit 64 before anything starts, since the call would wait on a person. The exit codes are 0 decided and committed, 1 inside a phase worktree, 5 a refused answer after the one corrective resume or a failed agent session, 8 a provider limit, 12 a refusal, 14 the provider unreachable (a network failure), 64 a verdicts file refused before anything runs.\n\nSide effects: in interactive mode, spawns an interactive and then a headless Claude Code session, both read-only whatever the security profile (only the Read, Grep and Glob tools, no MCP server), so the session never writes to the repository; keeps the session's prompts, transcripts, answer and diff under the state root's decide/<stamp>-<slug>/<NN>/; on an accepted diff, re-seeds a plan's extraction cache, writes the artifact and its sidecar (or the hand-authored artifact alone) and commits exactly those paths in one commit, with a `Decision-Id: <stamp>-<slug>/<NN>` trailer. Verdicts mode spawns one headless writer session, read-only like the others, on whatever provider routing selects, Mistral Vibe included, keeps verdicts.json (the file as given) with the prompts, answer and diff in the same folder, and writes and commits the same paths without a prompt.";

export function makeArtifactDecideCommand(deps: ArtifactDecideDeps = {}) {
  return defineCommand({
    name: "decide",
    summary:
      "Decide a Draft spec's or plan's open questions, in an interactive Claude Code session or from a verdicts file",
    help: DECIDE_HELP,
    examples: [
      "phax artifact decide docs/specs/2609251400-plan-prune.md",
      "phax artifact decide docs/specs/2609251400-plan-prune.md --question Q1",
      "phax artifact decide docs/plans/2609261000-plan-prune-store-plan.md --doctrine docs/doctrine/plan.md --model claude-sonnet-5-5 --effort medium",
      "phax artifact decide docs/specs/2609251400-plan-prune.md --verdicts verdicts.json --by operator",
      "phax artifact decide docs/specs/2609251400-plan-prune.md --verdicts - --by operator --json",
    ],
    input: { args: PathArg, flags: DecideFlags, stdin: VerdictsStdin },
    output: reject(DecideOutput),
    // An interactive session waits on the operator; without --by a terminal stands for them.
    prompts: (input) => input.stdin === undefined || input.flags.by === undefined,
    unprompted: "pass --verdicts and --by",
    check: ({ input, document }) =>
      checkVerdicts({
        pathArg: input.args[0],
        question: input.flags.question,
        file: input.stdin,
        document,
      }),
    run: ({ input, document, say, progress }) =>
      runDecide(
        {
          pathArg: input.args[0],
          flags: input.flags,
          verdicts: input.stdin === undefined ? undefined : document,
          say,
          progress,
        },
        deps,
      ),
    exits: sessionCommandExits,
    errors: sessionCommandErrors,
    texts: sessionCommandTexts,
    render: renderDecide,
    notes: notesOf,
  });
}
