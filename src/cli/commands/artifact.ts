import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import type { Command } from "commander";
import type { OutputPort } from "../../ports/output.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import { Backend } from "../../ports/backend.js";
import { FileSystem } from "../../ports/fs.js";
import { Git } from "../../ports/git.js";
import type { GitHub } from "../../ports/github.js";
import { NodeTerminalLayer } from "../../infra/terminal.js";
import type { Terminal } from "../../ports/terminal.js";
import { createArtifact, type CompletionFlags } from "../../app/createArtifact.js";
import { authorArtifact, recordPushWarning, recordWarning } from "../../app/authorArtifact.js";
import { loadConfig } from "../../app/loadConfig.js";
import { recordsClonePath } from "../../app/recordsSync.js";
import { loadModelRouting, loadProviderConfig } from "../../app/loadRouting.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { resolveModel } from "../../domain/routing/resolve.js";
import type { ArtifactKind, ArtifactStatus } from "../../domain/artifact/status.js";
import { resolveAuthoringSelection, type Effort } from "../../schemas/phaxConfig.js";
import { mountRunnerStub, runThroughOutput } from "../bridge.js";
import type { Command as RunnerCommand } from "../commandLibrary/contract/index.js";
import {
  artifactMigrateApprovalsCommand,
  artifactMigrateDocumentsCommand,
} from "../definitions/artifactMigrations.js";
import { artifactSchemaCommand } from "../definitions/artifactSchema.js";
import { artifactStatusCommand } from "../definitions/artifactStatus.js";
import {
  artifactAbandonCommand,
  artifactApproveCommand,
  artifactCompleteCommand,
  artifactReopenCommand,
  artifactStaleCommand,
  transitionLines,
} from "../definitions/artifactTransitions.js";
import {
  renderDocumentMigrationReport,
  renderMigrationReport,
} from "../../domain/artifact/render.js";
import { phaxProgram } from "../definitions/program.js";
import { findGitRoot, repoPaths } from "../definitions/shared.js";
import { defaultBundleRoot } from "./skills.js";
import { type DecideCommandOptions, runArtifactDecide } from "./artifactDecide.js";
import {
  exitCodeForAuthoringError,
  exitCodeForError,
  makeProviderBackendLayer,
} from "./runLayers.js";
import {
  isSessionFailureError,
  splitFollowUps,
  renderSessionFailure,
  retryCommandLine,
} from "./sessionFailureOutput.js";

const VALID_EFFORT_VALUES = ["low", "medium", "high"] as const;

function isValidEffort(value: string): value is Effort {
  return (VALID_EFFORT_VALUES as readonly string[]).includes(value);
}

const SKILL_SOURCE_DIR_FOR_KIND: Readonly<Record<ArtifactKind, string>> = {
  spec: "phax-spec",
  plan: "phax-planning",
};

// classifyArtifactPath matches on repo-relative POSIX paths, so a path typed
// as absolute or cwd-relative on the command line is normalized against the
// repo root the FileSystem layer is rooted at.
function toRepoRelativePath(pathArg: string, repoRoot: string): string {
  return repoPaths(pathArg, repoRoot).repoRelPath;
}

function buildLayer(repoRoot: string): Layer.Layer<FileSystem | Git | Terminal> {
  return Layer.mergeAll(
    makeRootedNodeFileSystemLayer(repoRoot),
    makeNodeGitLayer(),
    NodeTerminalLayer,
  );
}

/** `phax artifact status` answers through the command runner
 *  (src/cli/definitions/artifactStatus.ts); this is kept, until the last plan of
 *  command-contracts, as the definition's run and render over the OutputPort, for the tests
 *  that call it. */
export function runArtifactStatus(pathArg: string, out: OutputPort): Promise<number> {
  return runThroughOutput(artifactStatusCommand, { args: [pathArg] }, out, { lineByLine: true });
}

export interface TransitionFlags {
  /** `--by`, raw: the use case parses and resolves it. */
  readonly by?: string;
}

const TRANSITION_COMMANDS: Readonly<Record<ArtifactStatus, RunnerCommand<never>>> = {
  Approved: artifactApproveCommand,
  Stale: artifactStaleCommand,
  Abandoned: artifactAbandonCommand,
  Completed: artifactCompleteCommand,
  Draft: artifactReopenCommand,
};

/** The transitions answer through the command runner (src/cli/definitions/artifactTransitions.ts);
 *  this is kept, until the last plan of command-contracts, as the definition's run and render
 *  over the OutputPort, for the tests that call it. */
export function runArtifactTransition(
  pathArg: string,
  target: ArtifactStatus,
  out: OutputPort,
  flags: TransitionFlags = {},
): Promise<number> {
  return runThroughOutput(
    TRANSITION_COMMANDS[target],
    { args: [pathArg], flags: flags.by === undefined ? {} : { by: flags.by } },
    out,
    { sections: transitionLines },
  );
}

/** `phax artifact migrate-approvals`, kept as `runArtifactTransition` is. */
export function runArtifactMigrateApprovals(out: OutputPort): Promise<number> {
  return runThroughOutput(artifactMigrateApprovalsCommand, {}, out, {
    sections: renderMigrationReport,
  });
}

/** `phax artifact migrate-documents`, kept as `runArtifactTransition` is. */
export function runArtifactMigrateDocuments(out: OutputPort): Promise<number> {
  return runThroughOutput(artifactMigrateDocumentsCommand, {}, out, {
    sections: renderDocumentMigrationReport as (value: never) => readonly string[],
  });
}

export async function runCreateArtifact(
  kind: ArtifactKind,
  slug: string,
  sourceSpecArg: string | undefined,
  completion: CompletionFlags,
  out: OutputPort,
): Promise<number> {
  const repoRoot = findGitRoot(process.cwd());
  const sourceSpec =
    sourceSpecArg === undefined ? null : toRepoRelativePath(sourceSpecArg, repoRoot);
  const input = {
    kind,
    slug,
    sourceSpec,
    completion,
    nowIso: new Date().toISOString(),
    repoRoot,
  };
  const effect = createArtifact(input).pipe(
    Effect.provide(makeRootedNodeFileSystemLayer(repoRoot)),
  );
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return exitCodeForError(result.left);
  }

  const { path, sourceSpec: boundSpec, completesSpec } = result.right;
  if (kind === "spec") {
    out.log(`created ${path} (Draft)`);
  } else if (boundSpec === null || completesSpec === null) {
    out.log(`created ${path} (Draft, source-spec null)`);
  } else {
    out.log(
      `created ${path} (Draft, source-spec ${boundSpec}, completes-spec ${String(completesSpec)})`,
    );
  }
  return 0;
}

// `--brief -`: the one sanctioned stream read outside a port (see the plan's
// arbitration) — a path brief goes through the repo-rooted FileSystem layer instead.
function readStdinText(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      data += chunk;
    });
    stream.on("end", () => resolvePromise(data));
    stream.on("error", reject);
  });
}

interface AuthoringBrief {
  readonly text: string;
  readonly path: string | null;
}

async function resolveBriefText(
  briefArg: string,
  repoRoot: string,
  readStdin: () => Promise<string>,
): Promise<Either.Either<AuthoringBrief, string>> {
  if (briefArg === "-") {
    const text = await readStdin();
    return Either.right({ text, path: null });
  }

  const relPath = toRepoRelativePath(briefArg, repoRoot);
  const effect = Effect.gen(function* () {
    const fs = yield* FileSystem;
    return yield* fs.readText(relPath);
  }).pipe(Effect.provide(makeRootedNodeFileSystemLayer(repoRoot)));
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    return Either.left(`--brief ${relPath}: ${result.left.message}`);
  }
  return Either.right({ text: result.right, path: relPath });
}

export interface HeadlessArtifactOptions {
  readonly headless?: boolean;
  readonly brief?: string;
  readonly model?: string;
  readonly effort?: string;
}

interface PlanCreationOptions extends HeadlessArtifactOptions {
  readonly spec?: string;
  readonly last?: boolean;
  readonly notLast?: boolean;
}

// `artifact new spec` offers neither `--last` nor `--not-last`.
const NO_COMPLETION_FLAGS: CompletionFlags = { last: false, notLast: false };

export interface HeadlessArtifactDeps {
  readonly backendLayer?: Layer.Layer<Backend>;
  /** Repo visibility for the records destination policy (transcripts in-repo only). */
  readonly githubLayer?: Layer.Layer<GitHub>;
  readonly readStdin?: () => Promise<string>;
}

export async function runCreateArtifactHeadless(
  kind: ArtifactKind,
  slug: string,
  sourceSpecArg: string | undefined,
  completion: CompletionFlags,
  opts: HeadlessArtifactOptions,
  out: OutputPort,
  deps: HeadlessArtifactDeps = {},
): Promise<number> {
  if (opts.brief === undefined) {
    out.error("--brief <file|-> is required with --headless");
    return 12;
  }
  if (opts.effort !== undefined && !isValidEffort(opts.effort)) {
    out.error(
      `Invalid --effort value "${opts.effort}". Allowed values: ${VALID_EFFORT_VALUES.join(" | ")}`,
    );
    return 1;
  }
  const flagEffort = opts.effort as Effort | undefined;

  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;
  const repoRoot = config.repoRoot;

  const briefResult = await resolveBriefText(opts.brief, repoRoot, deps.readStdin ?? readStdinText);
  if (Either.isLeft(briefResult)) {
    out.error(briefResult.left);
    return 12;
  }
  const brief = briefResult.right;

  const sourceSpec =
    sourceSpecArg === undefined ? null : toRepoRelativePath(sourceSpecArg, repoRoot);

  const configuredSelection = kind === "spec" ? config.authoring.spec : config.authoring.plan;
  const selection = resolveAuthoringSelection({
    ...(opts.model !== undefined ? { flagModel: opts.model } : {}),
    ...(flagEffort !== undefined ? { flagEffort } : {}),
    configured: configuredSelection,
  });

  out.log(`authoring ${kind} ${slug} — ${selection.model} / ${selection.effort}`);

  const fsGitLayer = buildLayer(repoRoot);
  const routingResult = await Effect.runPromise(
    Effect.either(
      Effect.all({ routing: loadModelRouting(), providerConfig: loadProviderConfig() }),
    ).pipe(Effect.provide(fsGitLayer)),
  );
  if (Either.isLeft(routingResult)) {
    out.error(`Failed to load routing config: ${routingResult.left.message}`);
    return 1;
  }
  const { routing, providerConfig } = routingResult.right;

  const resolution = resolveModel(
    { model: selection.model, effort: selection.effort },
    routing,
    providerConfig,
    () => ({ allowed: true }),
  );

  const backendLayer = deps.backendLayer ?? makeProviderBackendLayer(providerConfig);
  const layer = Layer.mergeAll(fsGitLayer, backendLayer, deps.githubLayer ?? NodeGitHubLayer);

  const effect = Effect.gen(function* () {
    const fs = yield* FileSystem;
    const skillPath = join(defaultBundleRoot(), SKILL_SOURCE_DIR_FOR_KIND[kind], "SKILL.md");
    const skillText = yield* fs.readText(skillPath);
    return yield* authorArtifact({
      kind,
      slug,
      brief,
      sourceSpec,
      completion,
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
      output: out,
      ...(config.records.destination.kind === "repo"
        ? { recordsClonePath: recordsClonePath(config.stateRoot, config.namespace) }
        : {}),
    });
  }).pipe(Effect.provide(layer));

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    const { cause, followUps } = splitFollowUps(result.left);
    if (isSessionFailureError(cause)) {
      const retry = retryCommandLine([
        "artifact",
        "new",
        kind,
        slug,
        ...(sourceSpecArg === undefined ? [] : ["--spec", sourceSpecArg]),
        ...(completion.last ? ["--last"] : []),
        ...(completion.notLast ? ["--not-last"] : []),
        "--headless",
        "--brief",
        opts.brief,
        ...(opts.model === undefined ? [] : ["--model", opts.model]),
        ...(opts.effort === undefined ? [] : ["--effort", opts.effort]),
      ]);
      const pipeNote = opts.brief === "-" ? " (pipe the same brief again)" : "";
      for (const line of renderSessionFailure(cause, `${retry}${pipeNote}`)) {
        out.error(line);
      }
    } else {
      out.error(`✗ authoring failed: ${(cause as { message: string }).message}`);
    }
    for (const followUp of followUps) out.warn(followUp);
    return exitCodeForAuthoringError(result.left);
  }

  const { path, sidecarPath, commit, record, recordPush } = result.right;
  out.log(`created ${path} (Draft, headless)`);
  out.log(`sidecar ${sidecarPath}`);
  out.log(`commit ${commit.hash.slice(0, 7)} — ${commit.subject}`);
  if (record.kind === "written") out.log(`record ${record.key}`);
  else if (record.kind === "records-off") out.log("record off");
  else out.warn(recordWarning(record) ?? "authoring record not written");
  const pushWarning = recordPushWarning(recordPush);
  if (pushWarning !== undefined) out.warn(pushWarning);
  return 0;
}

type SchemaKind = ArtifactKind | "verdicts";

/** `phax artifact schema`, kept as `runArtifactTransition` is. */
export function runArtifactSchema(kind: SchemaKind, out: OutputPort): Promise<number> {
  return runThroughOutput(artifactSchemaCommand, { args: [kind] }, out, { wholeDocument: true });
}

const ARCHIVE_REFUSAL_MESSAGE =
  'unknown transition "archive" — the completion transition is: phax artifact complete <path>';

export function runArtifactArchiveRefusal(out: OutputPort): number {
  out.error(ARCHIVE_REFUSAL_MESSAGE);
  return 1;
}

// `artifact` is the parent command; each transition and `status` are real nested
// subcommands (never a single space-separated command name — see the warning in
// security.ts about that collision).
export function registerArtifactCommand(program: Command, out: OutputPort): void {
  const artifactCmd = program
    .command("artifact")
    .description("Inspect and transition the lifecycle status of a spec or plan");

  // `status` answers through the runner: its help-only stub, in place.
  mountRunnerStub(artifactCmd, phaxProgram, ["artifact", "status"]);

  // The transitions answer through the runner: their help-only stubs, in place.
  for (const name of ["approve", "stale", "abandon", "complete", "reopen"]) {
    mountRunnerStub(artifactCmd, phaxProgram, ["artifact", name]);
  }

  artifactCmd
    .command("decide")
    .description(
      "Decide a Draft spec's or plan's open questions, in an interactive Claude Code session or from a verdicts file",
    )
    .argument("<path>", "Path to a spec or plan file under docs/specs/ or docs/plans/")
    .option("--question <id>", "Present this question alone: an open one, or re-arbitrate one")
    .option(
      "--verdicts <file|->",
      "Decide from a verdicts file, or - for stdin, without an interactive session",
    )
    .option(
      "--by <arbiter>",
      "operator: who gave the verdicts; required without a terminal (with --verdicts)",
    )
    .option("--json", "Print the report as one JSON object (with --verdicts)")
    .option("--doctrine <file>", "Append this doctrine file after the decide skill")
    .option("--model <model>", "Override the decide model (interactive: a Claude Code model)")
    .option("--effort <effort>", "Override the decide effort")
    .action(async (path: string, cmdOpts: DecideCommandOptions) => {
      const exitCode = await runArtifactDecide(path, cmdOpts, out);
      process.exit(exitCode);
    });

  // `new` is a parent command; `spec` and `plan` are real nested subcommands
  // (never a single space-separated command name — see the warning above).
  const newCmd = artifactCmd
    .command("new")
    .description("Create a Draft spec or plan named from the current UTC minute");

  newCmd
    .command("spec")
    .description("Create a Draft spec at docs/specs/<YYMMDDHHMM>-<slug>.md")
    .argument("<slug>", "Slug matching `[a-z0-9]+(-[a-z0-9]+)*`")
    .option(
      "--headless",
      "Author via a recorded agent session from a brief instead of a blank skeleton (experimental)",
    )
    .option("--brief <file|->", "Path to a brief file, or - to read the brief from stdin")
    .option("--model <model>", "Override the authoring model (default: flag → config → catalog)")
    .option("--effort <effort>", "Override the authoring effort (low|medium|high)")
    .action(async (slug: string, cmdOpts: HeadlessArtifactOptions) => {
      const exitCode = cmdOpts.headless
        ? await runCreateArtifactHeadless(
            "spec",
            slug,
            undefined,
            NO_COMPLETION_FLAGS,
            cmdOpts,
            out,
          )
        : await runCreateArtifact("spec", slug, undefined, NO_COMPLETION_FLAGS, out);
      process.exit(exitCode);
    });

  newCmd
    .command("plan")
    .description("Create a Draft plan at docs/plans/<YYMMDDHHMM>-<slug>-plan.md")
    .argument("<slug>", "Slug matching `[a-z0-9]+(-[a-z0-9]+)*`")
    .option("--spec <path>", "Path to the source spec to bind as source-spec")
    .option("--last", "This plan is its spec's last: its run completes the spec")
    .option("--not-last", "More plans of the spec follow: its run leaves the spec live")
    .option(
      "--headless",
      "Author via a recorded agent session from a brief instead of a blank skeleton (experimental)",
    )
    .option("--brief <file|->", "Path to a brief file, or - to read the brief from stdin")
    .option("--model <model>", "Override the authoring model (default: flag → config → catalog)")
    .option("--effort <effort>", "Override the authoring effort (low|medium|high)")
    .action(async (slug: string, cmdOpts: PlanCreationOptions) => {
      // The pairing rule lives in the use case; the CLI passes the raw flags.
      const completion = { last: cmdOpts.last === true, notLast: cmdOpts.notLast === true };
      const exitCode = cmdOpts.headless
        ? await runCreateArtifactHeadless("plan", slug, cmdOpts.spec, completion, cmdOpts, out)
        : await runCreateArtifact("plan", slug, cmdOpts.spec, completion, out);
      process.exit(exitCode);
    });

  for (const name of ["schema", "migrate-approvals", "migrate-documents"]) {
    mountRunnerStub(artifactCmd, phaxProgram, ["artifact", name]);
  }

  // Retired verb: kept as a hidden subcommand so the invocation fails with a
  // useful message naming its replacement, instead of Commander's generic
  // "unknown command". Hidden means absent from --help and, once
  // scripts/generate-usage-spec.ts skips hidden commands, from phax.usage.kdl
  // and everything derived from it.
  artifactCmd
    .command("archive", { hidden: true })
    .argument("[path]", "Path to a spec or plan file under docs/specs/ or docs/plans/")
    .action(() => {
      const exitCode = runArtifactArchiveRefusal(out);
      process.exit(exitCode);
    });
}
