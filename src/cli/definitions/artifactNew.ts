// `phax artifact new spec|plan <slug>` as the runner reads them. Without `--headless` each writes
// a Draft skeleton and answers its path, kind and lineage; with it, a recorded agent session
// authors the artifact from the `--brief` document, which the runner reads from the file named or
// from stdin (`-`) before anything runs, and the command answers the artifact, its sidecar, its
// commit and its authoring record. The `authoring …` line is said on stdout as the session starts,
// the session's retry warning is a progress line, and the record's and push's warnings are notes.
// A failed session is a declared error with today's lines and code; a failed commit lists the
// artifact and its sidecar it left written.
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import * as Schema from "effect/Schema";
import { authorArtifact, recordPushWarning, recordWarning } from "../../app/authorArtifact.js";
import { type CompletionFlags, createArtifact } from "../../app/createArtifact.js";
import { loadConfig } from "../../app/loadConfig.js";
import { loadModelRouting, loadProviderConfig } from "../../app/loadRouting.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { recordsClonePath } from "../../app/recordsSync.js";
import type { ArtifactKind } from "../../domain/artifact/status.js";
import { resolveModel } from "../../domain/routing/resolve.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import { NodeTerminalLayer } from "../../infra/terminal.js";
import type { Backend } from "../../ports/backend.js";
import { FileSystem } from "../../ports/fs.js";
import type { GitHub } from "../../ports/github.js";
import { type Effort, resolveAuthoringSelection } from "../../schemas/phaxConfig.js";
import {
  defineCommand,
  reject,
  type StdinDocument,
  Written,
} from "../commandLibrary/contract/index.js";
import { makeProviderBackendLayer } from "../commands/runLayers.js";
import {
  isSessionFailureError,
  renderSessionFailure,
  retryCommandLine,
} from "../commands/sessionFailureOutput.js";
import { defaultBundleRoot } from "./skills.js";
import {
  exposeMessage,
  findGitRoot,
  MessageFields,
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
export interface ArtifactNewDeps {
  readonly backendLayer?: Layer.Layer<Backend>;
  /** Repo visibility for the records destination policy (transcripts in-repo only). */
  readonly githubLayer?: Layer.Layer<GitHub>;
}

const VALID_EFFORT_VALUES = ["low", "medium", "high"] as const;

function isValidEffort(value: string): value is Effort {
  return (VALID_EFFORT_VALUES as readonly string[]).includes(value);
}

const SKILL_SOURCE_DIR_FOR_KIND: Readonly<Record<ArtifactKind, string>> = {
  spec: "phax-spec",
  plan: "phax-planning",
};

// `artifact new spec` offers neither `--last` nor `--not-last`.
const NO_COMPLETION_FLAGS: CompletionFlags = { last: false, notLast: false };

const SlugArg = reject(
  Schema.Tuple(
    Schema.String.annotations({
      identifier: "slug",
      description: "Slug matching `[a-z0-9]+(-[a-z0-9]+)*`",
    }),
  ),
);

const optional = <S extends Schema.Schema.Any>(schema: S) =>
  Schema.optionalWith(schema, { exact: true });

const headlessFields = {
  headless: optional(
    Schema.Boolean.annotations({
      description:
        "Author via a recorded agent session from a brief instead of a blank skeleton (experimental)",
    }),
  ),
  model: optional(
    Schema.String.annotations({
      identifier: "model",
      description: "Override the authoring model (default: flag → config → catalog)",
    }),
  ),
  effort: optional(
    Schema.String.annotations({
      identifier: "effort",
      description: "Override the authoring effort (low|medium|high)",
    }),
  ),
};

const SpecFlags = reject(Schema.Struct(headlessFields));

const PlanFlags = reject(
  Schema.Struct({
    spec: optional(
      Schema.String.annotations({
        identifier: "path",
        description: "Path to the source spec to bind as source-spec",
      }),
    ),
    last: optional(
      Schema.Boolean.annotations({
        description: "This plan is its spec's last: its run completes the spec",
      }),
    ),
    notLast: optional(
      Schema.Boolean.annotations({
        description: "More plans of the spec follow: its run leaves the spec live",
      }),
    ),
    ...headlessFields,
  }),
);

/** `--brief <file|->`: the brief's text, read by the runner from the file named or from stdin. */
const BriefStdin = reject(
  Schema.String.annotations({
    identifier: "brief",
    description: "Path to a brief file, or - to read the brief from stdin",
  }),
  { flag: "brief", text: true, valueRequired: true },
);

const BlankOutput = Schema.Struct({
  path: Schema.String,
  kind: Schema.Literal("spec", "plan"),
  sourceSpec: Schema.NullOr(Schema.String),
  completesSpec: Schema.NullOr(Schema.Boolean),
  written: Schema.Array(Written),
});

const HeadlessOutput = Schema.Struct({
  path: Schema.String,
  sidecarPath: Schema.String,
  commit: Schema.Struct({ hash: Schema.String, subject: Schema.String }),
  record: RecordOutcome,
  written: Schema.Array(Written),
});

/** What `artifact new` answers: a blank skeleton, or (with `--headless`) an authored artifact. */
const NewOutput = Schema.Union(BlankOutput, HeadlessOutput);

type NewOutput = typeof NewOutput.Type;

/** The flags of either kind, as the run reads them. */
interface NewFlags {
  readonly spec?: string;
  readonly last?: boolean;
  readonly notLast?: boolean;
  readonly headless?: boolean;
  readonly model?: string;
  readonly effort?: string;
}

interface NewContext {
  readonly kind: ArtifactKind;
  readonly slug: string;
  readonly flags: NewFlags;
  readonly brief: StdinDocument | undefined;
  readonly say: (text: string) => Effect.Effect<void>;
  readonly progress: (text: string) => Effect.Effect<void>;
  readonly backendLayer: Layer.Layer<Backend> | undefined;
  readonly githubLayer: Layer.Layer<GitHub> | undefined;
}

/** The completion flags a plan passes raw: the pairing rule lives in the use case. */
const completionOf = (kind: ArtifactKind, flags: NewFlags): CompletionFlags =>
  kind === "spec"
    ? NO_COMPLETION_FLAGS
    : { last: flags.last === true, notLast: flags.notLast === true };

/** A Draft skeleton, as today: no commit, the file written. */
function createBlank(context: NewContext) {
  return Effect.gen(function* () {
    const { kind, slug, flags } = context;
    const repoRoot = findGitRoot(process.cwd());
    const sourceSpec =
      flags.spec === undefined ? null : repoPaths(flags.spec, repoRoot).repoRelPath;
    const result = yield* createArtifact({
      kind,
      slug,
      sourceSpec,
      completion: completionOf(kind, flags),
      nowIso: new Date().toISOString(),
      repoRoot,
    }).pipe(Effect.provide(makeRootedNodeFileSystemLayer(repoRoot)));
    const output: NewOutput = {
      path: result.path,
      kind,
      sourceSpec: result.sourceSpec,
      completesSpec: result.completesSpec,
      written: yield* writtenRecords([result.path], repoRoot),
    };
    return output;
  });
}

/** The words of the call, to run it again after a network failure. */
function retryOf(context: NewContext, brief: string): string {
  const { kind, slug, flags } = context;
  const completion = completionOf(kind, flags);
  const retry = retryCommandLine([
    "artifact",
    "new",
    kind,
    slug,
    ...(flags.spec === undefined ? [] : ["--spec", flags.spec]),
    ...(completion.last ? ["--last"] : []),
    ...(completion.notLast ? ["--not-last"] : []),
    "--headless",
    "--brief",
    brief,
    ...(flags.model === undefined ? [] : ["--model", flags.model]),
    ...(flags.effort === undefined ? [] : ["--effort", flags.effort]),
  ]);
  return brief === "-" ? `${retry} (pipe the same brief again)` : retry;
}

/** An artifact authored by a recorded agent session from the brief. */
function author(context: NewContext) {
  return Effect.gen(function* () {
    const { kind, slug, flags, brief } = context;
    if (brief === undefined) {
      return yield* Effect.fail(
        sessionCommandRefusal(12, "--brief <file|-> is required with --headless"),
      );
    }
    if (flags.effort !== undefined && !isValidEffort(flags.effort)) {
      return yield* Effect.fail(
        sessionCommandRefusal(
          1,
          `Invalid --effort value "${flags.effort}". Allowed values: ${VALID_EFFORT_VALUES.join(" | ")}`,
        ),
      );
    }
    const flagEffort = flags.effort as Effort | undefined;

    const configResult = loadConfig(process.cwd());
    if (Either.isLeft(configResult)) {
      return yield* Effect.fail(
        sessionCommandRefusal(1, `Config error: ${configResult.left.message}`),
      );
    }
    const config = configResult.right;
    const repoRoot = config.repoRoot;
    const briefPath =
      brief.origin.kind === "file" ? repoPaths(brief.origin.path, repoRoot).repoRelPath : null;
    const sourceSpec =
      flags.spec === undefined ? null : repoPaths(flags.spec, repoRoot).repoRelPath;

    const selection = resolveAuthoringSelection({
      ...(flags.model !== undefined ? { flagModel: flags.model } : {}),
      ...(flagEffort !== undefined ? { flagEffort } : {}),
      configured: kind === "spec" ? config.authoring.spec : config.authoring.plan,
    });

    yield* context.say(`authoring ${kind} ${slug} — ${selection.model} / ${selection.effort}`);

    const fsGitLayer = Layer.mergeAll(
      makeRootedNodeFileSystemLayer(repoRoot),
      makeNodeGitLayer(),
      NodeTerminalLayer,
    );
    const routed = yield* Effect.either(
      Effect.all({ routing: loadModelRouting(), providerConfig: loadProviderConfig() }).pipe(
        Effect.provide(fsGitLayer),
      ),
    );
    if (Either.isLeft(routed)) {
      return yield* Effect.fail(
        sessionCommandRefusal(1, `Failed to load routing config: ${routed.left.message}`),
      );
    }
    const { routing, providerConfig } = routed.right;
    const resolution = resolveModel(
      { model: selection.model, effort: selection.effort },
      routing,
      providerConfig,
      () => ({ allowed: true }),
    );

    const layer = Layer.mergeAll(
      fsGitLayer,
      context.backendLayer ?? makeProviderBackendLayer(providerConfig),
      context.githubLayer ?? NodeGitHubLayer,
    );
    const warn = (text: string): void => Effect.runSync(context.progress(text));
    const authored = yield* Effect.either(
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const skillPath = join(defaultBundleRoot(), SKILL_SOURCE_DIR_FOR_KIND[kind], "SKILL.md");
        const skillText = yield* fs.readText(skillPath);
        return yield* authorArtifact({
          kind,
          slug,
          brief: { text: brief.text, path: briefPath },
          sourceSpec,
          completion: completionOf(kind, flags),
          model: selection.model,
          effort: selection.effort,
          resolution,
          skillText,
          security: config.security,
          repoRoot,
          stateRoot: effectiveStateRoot(config),
          extractPlanModel: config.extractPlanModel,
          extractPlanEffort: config.extractPlanEffort,
          nowIso: new Date().toISOString(),
          records: config.records,
          publishRemote: config.publish.remote,
          architectureProvider: config.architecture !== undefined,
          acceptanceProvider: config.acceptance !== undefined,
          assignmentBounds: config.assignments !== undefined,
          output: { warn },
          ...(config.records.destination.kind === "repo"
            ? { recordsClonePath: recordsClonePath(config.stateRoot, config.namespace) }
            : {}),
        });
      }).pipe(Effect.provide(layer)),
    );
    if (Either.isLeft(authored)) {
      const retry = retryOf(context, brief.origin.kind === "file" ? brief.origin.path : "-");
      return yield* Effect.fail(
        yield* sessionFailure(
          authored.left,
          (cause) =>
            isSessionFailureError(cause)
              ? renderSessionFailure(cause, retry)
              : [`✗ authoring failed: ${(cause as { message: string }).message}`],
          repoRoot,
        ),
      );
    }
    const { path, sidecarPath, commit, record, recordPush } = authored.right;
    const output: NewOutput = {
      path,
      sidecarPath,
      commit: { hash: commit.hash, subject: commit.subject },
      record: recordOutcome(record, recordPush, {
        warningOf: recordWarning,
        pushWarningOf: recordPushWarning,
        fallback: "authoring record not written",
      }),
      written: yield* writtenRecords([path, sidecarPath], repoRoot),
    };
    return output;
  });
}

/** Today's lines, from the answer alone. */
function renderNew(value: NewOutput): string {
  if ("sidecarPath" in value) {
    const lines = [
      `created ${value.path} (Draft, headless)`,
      `sidecar ${value.sidecarPath}`,
      `commit ${value.commit.hash.slice(0, 7)} — ${value.commit.subject}`,
    ];
    if (value.record.kind === "written") lines.push(`record ${value.record.key}`);
    else if (value.record.kind === "off") lines.push("record off");
    return lines.join("\n");
  }
  if (value.kind === "spec") return `created ${value.path} (Draft)`;
  if (value.sourceSpec === null || value.completesSpec === null) {
    return `created ${value.path} (Draft, source-spec null)`;
  }
  return `created ${value.path} (Draft, source-spec ${value.sourceSpec}, completes-spec ${String(value.completesSpec)})`;
}

const notesOf = (value: NewOutput): string =>
  "sidecarPath" in value ? recordNotes(value.record) : "";

const sentence = (error: { readonly message: string }): string => error.message;

// A blank skeleton's refusals are the use case's (exit 12, a read failure 1); an authoring
// session's are the session command's.
const exits = { ArtifactCreationError: 12, FsError: 1, ...sessionCommandExits } as const;
const errors = {
  ArtifactCreationError: MessageFields,
  FsError: MessageFields,
  ...sessionCommandErrors,
} as const;
const texts = {
  ArtifactCreationError: sentence,
  FsError: sentence,
  ...sessionCommandTexts,
} as const;

/** One call of `artifact new <kind>`: a skeleton, or an authored artifact with `--headless`. */
function runNew(context: NewContext) {
  return Effect.gen(function* () {
    return context.flags.headless === true ? yield* author(context) : yield* createBlank(context);
  }).pipe(Effect.mapError(exposeMessage));
}

export function makeArtifactNewSpecCommand(deps: ArtifactNewDeps = {}) {
  return defineCommand({
    name: "spec",
    summary: "Create a Draft spec at docs/specs/<YYMMDDHHMM>-<slug>.md",
    help: "Creates a Draft spec at docs/specs/<YYMMDDHHMM>-<slug>.md, with a frontmatter-only skeleton (status, date, audience, scope). The slug must match `[a-z0-9]+(-[a-z0-9]+)*`.\n\nSide effects: writes the new spec file. Does not commit — transition commands (phax artifact approve) commit, creation does not.\n\nPass --headless --brief <file|-> (experimental) to author the spec itself instead of writing a blank skeleton: phax spawns a recorded agent session with the phax-spec skill and the spec document JSON Schema, accepts a schema-valid document as the session's only output, renders it to the canonical Markdown, and writes the rendered spec plus its JSON sidecar. --model and --effort override the resolved authoring model/effort (flag, then phax.json's authoring.spec, then the catalog default). Side effects: spawns a provider session; on success, writes and commits the spec and its sidecar in one commit; nothing lands on a refusal or an invalid session result. When records are configured, every session that ran — committed or failed — writes one authoring record (key authoring/<YYMMDDHHMM>-<slug>) on phax/records/v1, and `phax records explain <commit>` resolves it through the artifact commit's Authoring-Id trailer.",
    examples: [
      "phax artifact new spec plan-prune",
      "phax artifact new spec plan-prune --headless --brief brief.md",
    ],
    input: { args: SlugArg, flags: SpecFlags, stdin: BriefStdin },
    output: reject(NewOutput),
    run: ({ input, document, say, progress }) =>
      runNew({
        kind: "spec",
        slug: input.args[0],
        flags: input.flags,
        brief: input.stdin === undefined ? undefined : document,
        say,
        progress,
        backendLayer: deps.backendLayer,
        githubLayer: deps.githubLayer,
      }),
    exits,
    errors,
    texts,
    render: renderNew,
    notes: notesOf,
  });
}

export function makeArtifactNewPlanCommand(deps: ArtifactNewDeps = {}) {
  return defineCommand({
    name: "plan",
    summary: "Create a Draft plan at docs/plans/<YYMMDDHHMM>-<slug>-plan.md",
    help: "Creates a Draft plan at docs/plans/<YYMMDDHHMM>-<slug>-plan.md, with a frontmatter-only skeleton (status, source-spec, and completes-spec when a spec is bound). Pass --spec <path> to bind an existing spec as the plan's source-spec; the path must classify as a spec (live or archived), exist, and pass artifact validation. With --spec, pass exactly one of --last or --not-last: --last writes completes-spec: true (this plan is the spec's last, and its run completes the spec), --not-last writes completes-spec: false (more plans of the spec follow, and its run leaves the spec live). Every plan of a spec except the last says --not-last; no default is ever inferred. Without --spec, source-spec is written as null with no completes-spec, and both flags are refused. The slug must match `[a-z0-9]+(-[a-z0-9]+)*`.\n\nSide effects: writes the new plan file. Does not commit — transition commands (phax artifact approve) commit, creation does not.\n\nPass --headless --brief <file|-> (experimental) to author the plan itself instead of writing a blank skeleton: phax spawns a recorded agent session with the phax-planning skill and the plan document JSON Schema (the extracted-plan shape plus informational content), accepts a schema-valid document as the session's only output, renders it to the phax-planning Markdown shape, writes the rendered plan plus its JSON sidecar, and seeds the extraction cache so phax run never re-extracts it. --model and --effort override the resolved authoring model/effort (flag, then phax.json's authoring.plan, then the catalog default). Side effects: spawns a provider session; on success, writes and commits the plan and its sidecar in one commit and seeds the extraction cache; nothing lands on a refusal or an invalid session result. When records are configured, every session that ran — committed or failed — writes one authoring record (key authoring/<YYMMDDHHMM>-<slug>) on phax/records/v1, and `phax records explain <commit>` resolves it through the artifact commit's Authoring-Id trailer.",
    examples: [
      "phax artifact new plan plan-prune-store --spec docs/specs/2609091412-plan-prune.md --not-last",
      "phax artifact new plan plan-prune-cli --spec docs/specs/2609091412-plan-prune.md --last",
      "phax artifact new plan catalog-refresh",
      "phax artifact new plan plan-prune --headless --brief brief.md --spec docs/specs/2609091412-plan-prune.md --last",
    ],
    input: { args: SlugArg, flags: PlanFlags, stdin: BriefStdin },
    output: reject(NewOutput),
    run: ({ input, document, say, progress }) =>
      runNew({
        kind: "plan",
        slug: input.args[0],
        flags: input.flags,
        brief: input.stdin === undefined ? undefined : document,
        say,
        progress,
        backendLayer: deps.backendLayer,
        githubLayer: deps.githubLayer,
      }),
    exits,
    errors,
    texts,
    render: renderNew,
    notes: notesOf,
  });
}
