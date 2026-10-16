import { execSync } from "node:child_process";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Effect, Either, Layer } from "effect";
import { Argument, type Command } from "commander";
import type { OutputPort } from "../../ports/output.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import { makeNodeBackendLayer } from "../../infra/claudeCli.js";
import { Backend } from "../../ports/backend.js";
import { FileSystem } from "../../ports/fs.js";
import { Git } from "../../ports/git.js";
import type { GitHub } from "../../ports/github.js";
import {
  type ArtifactAuthoring,
  type ArtifactQuestions,
  inspectArtifact,
  transitionArtifactBy,
} from "../../app/artifactStatus.js";
import { type Arbiter, describeArbiter } from "../../domain/artifact/arbiter.js";
import { describeStampedShape } from "../../domain/artifact/sidecar.js";
import { NodeTerminalLayer } from "../../infra/terminal.js";
import type { Terminal } from "../../ports/terminal.js";
import { createArtifact, type CompletionFlags } from "../../app/createArtifact.js";
import { authorArtifact, recordPushWarning, recordWarning } from "../../app/authorArtifact.js";
import { loadConfig } from "../../app/loadConfig.js";
import { recordsClonePath } from "../../app/recordsSync.js";
import { loadModelRouting, loadProviderConfig } from "../../app/loadRouting.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { resolveModel } from "../../domain/routing/resolve.js";
import { migrateApprovals } from "../../app/migrateApprovals.js";
import { migrateDocuments } from "../../app/migrateDocuments.js";
import {
  renderDocumentMigrationReport,
  renderMigrationReport,
  renderOrphanRecordWarning,
  renderQuestionCounts,
} from "../../domain/artifact/render.js";
import type { ArtifactKind, ArtifactStatus } from "../../domain/artifact/status.js";
import { getPlanDocumentJsonSchema } from "../../schemas/planDocument.js";
import { getSpecDocumentJsonSchema } from "../../schemas/specDocument.js";
import { resolveAuthoringSelection, type Effort } from "../../schemas/phaxConfig.js";
import { defaultBundleRoot } from "./skills.js";
import { type DecideCommandOptions, runArtifactDecide } from "./artifactDecide.js";
import { exitCodeForAuthoringError, exitCodeForError } from "./runLayers.js";

const VALID_EFFORT_VALUES = ["low", "medium", "high"] as const;

function isValidEffort(value: string): value is Effort {
  return (VALID_EFFORT_VALUES as readonly string[]).includes(value);
}

const SKILL_SOURCE_DIR_FOR_KIND: Readonly<Record<ArtifactKind, string>> = {
  spec: "phax-spec",
  plan: "phax-planning",
};

function findGitRoot(startDir: string): string {
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return root.length > 0 ? root : startDir;
  } catch {
    return startDir;
  }
}

// classifyArtifactPath matches on repo-relative POSIX paths, so a path typed
// as absolute or cwd-relative on the command line is normalized here against
// the repo root the FileSystem layer is rooted at.
function toRepoRelativePath(pathArg: string, repoRoot: string): string {
  const absolute = isAbsolute(pathArg) ? pathArg : resolve(process.cwd(), pathArg);
  const rel = relative(repoRoot, absolute);
  return rel.split(sep).join("/");
}

function buildLayer(repoRoot: string): Layer.Layer<FileSystem | Git | Terminal> {
  return Layer.mergeAll(
    makeRootedNodeFileSystemLayer(repoRoot),
    makeNodeGitLayer(),
    NodeTerminalLayer,
  );
}

function authoringText(authoring: ArtifactAuthoring): string {
  if (authoring.kind === "interactive") return "interactive (no sidecar)";
  const { agreement, sidecarPath } = authoring;
  const state =
    agreement === "in-sync"
      ? "in sync"
      : agreement === "diverged"
        ? "diverged — body differs from the sidecar's rendering"
        : agreement.kind === "invalid"
          ? `invalid sidecar — ${agreement.message}`
          : `${describeStampedShape(agreement.format, agreement.shape)} — migrate with \`phax artifact migrate-documents\``;
  return `headless — sidecar ${sidecarPath} (${state})`;
}

// `<n> — open <k> (<ids>) · arbitrated <m> (<l> lifted)`, or the departing line.
function questionsText(questions: ArtifactQuestions): string | null {
  if (questions.kind === "none") return null;
  if (questions.kind === "departs") {
    return `does not parse — line ${String(questions.line)} departs from the §9 format: ${questions.text}`;
  }
  const { summary } = questions;
  return `${String(summary.open.length + summary.arbitrated)} — ${renderQuestionCounts(summary)}`;
}

// `by machine (<grant>)`, `by operator (<name>)`, or `unattributed`.
function approverText(approvedBy: Arbiter): string {
  const described = describeArbiter(approvedBy);
  return approvedBy.kind === "unattributed" ? described : `by ${described}`;
}

export async function runArtifactStatus(pathArg: string, out: OutputPort): Promise<number> {
  const repoRoot = findGitRoot(process.cwd());
  const repoRelPath = toRepoRelativePath(pathArg, repoRoot);
  const effect = inspectArtifact(repoRelPath).pipe(Effect.provide(buildLayer(repoRoot)));
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return exitCodeForError(result.left);
  }

  const { kind, status, legalTargets, approval, authoring, questions, orphanRecords } =
    result.right;
  out.log(`Path:              ${repoRelPath}`);
  out.log(`Kind:              ${kind}`);
  out.log(`Status:            ${status}`);
  out.log(`Authored:          ${authoringText(authoring)}`);
  const questionsLine = questionsText(questions);
  if (questionsLine !== null) out.log(`Questions:         ${questionsLine}`);
  if (approval.kind === "recorded") {
    out.log(
      `Approved:          ${approval.date} @ ${approval.baseline} ${approverText(approval.approvedBy)}`,
    );
    out.log(`Edited since:      ${approval.editedSinceApproval ? "yes" : "no"}`);
  } else if (approval.kind === "unrecorded") {
    out.log(`Approved:          (unrecorded — run phax artifact approve to record)`);
  }
  out.log(
    `Legal transitions: ${legalTargets.length > 0 ? legalTargets.join(", ") : "(none — terminal)"}`,
  );
  for (const orphan of orphanRecords) out.warn(renderOrphanRecordWarning(orphan));
  return 0;
}

export interface TransitionFlags {
  /** `--by`, raw: the use case parses and resolves it. */
  readonly by?: string;
}

export async function runArtifactTransition(
  pathArg: string,
  target: ArtifactStatus,
  out: OutputPort,
  flags: TransitionFlags = {},
): Promise<number> {
  const repoRoot = findGitRoot(process.cwd());
  const repoRelPath = toRepoRelativePath(pathArg, repoRoot);
  const opts = { repoRoot, nowIso: new Date().toISOString(), commit: true, by: flags.by };
  const effect = transitionArtifactBy(repoRelPath, target, opts).pipe(
    Effect.provide(buildLayer(repoRoot)),
  );
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return exitCodeForError(result.left);
  }

  const {
    status,
    previousStatus,
    path,
    approvedBaseline,
    approvedBy,
    reopenedBy,
    deletedRecord,
    boundPlans = [],
    commit: madeCommit,
  } = result.right;
  out.log(
    deletedRecord === undefined
      ? `Status: ${status}`
      : `Status: ${status} (was ${previousStatus}; ${deletedRecord} deleted)`,
  );
  if (approvedBy !== undefined) {
    out.log(`Approver: ${describeArbiter(approvedBy)}`);
  }
  if (reopenedBy !== undefined) {
    out.log(`Reopened-By: ${describeArbiter(reopenedBy)}`);
  }
  for (const plan of boundPlans) {
    out.log(`Bound:  ${plan.path} (${plan.status}) — left as is`);
  }
  if (target === "Abandoned" || target === "Completed") {
    out.log(`Path:   ${path}`);
  }
  if (approvedBaseline !== undefined) {
    out.log(`Baseline: ${approvedBaseline.slice(0, 7)}`);
  }
  if (madeCommit !== undefined) {
    out.log(`Commit: ${madeCommit.hash.slice(0, 7)} — ${madeCommit.subject}`);
  }
  return 0;
}

export async function runArtifactMigrateApprovals(out: OutputPort): Promise<number> {
  const repoRoot = findGitRoot(process.cwd());
  const effect = migrateApprovals({ repoRoot }).pipe(Effect.provide(buildLayer(repoRoot)));
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return exitCodeForError(result.left);
  }

  for (const line of renderMigrationReport(result.right)) out.log(line);
  if (result.right.kind === "migrated") {
    for (const orphan of result.right.orphans) out.warn(renderOrphanRecordWarning(orphan));
  }
  return 0;
}

export async function runArtifactMigrateDocuments(out: OutputPort): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;
  const effect = migrateDocuments({
    repoRoot: config.repoRoot,
    stateRoot: effectiveStateRoot(config),
    extractPlanModel: config.extractPlanModel,
    extractPlanEffort: config.extractPlanEffort,
    nowIso: new Date().toISOString(),
  }).pipe(Effect.provide(buildLayer(config.repoRoot)));
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return exitCodeForAuthoringError(result.left);
  }

  for (const line of renderDocumentMigrationReport(result.right)) out.log(line);
  return 0;
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

  const backendLayer = deps.backendLayer ?? makeNodeBackendLayer(providerConfig);
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
      output: out,
      ...(config.records.destination.kind === "repo"
        ? { recordsClonePath: recordsClonePath(config.stateRoot, config.namespace) }
        : {}),
    });
  }).pipe(Effect.provide(layer));

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(`✗ authoring failed: ${result.left.message}`);
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

const DOCUMENT_JSON_SCHEMAS: Readonly<Record<ArtifactKind, () => object>> = {
  spec: getSpecDocumentJsonSchema,
  plan: getPlanDocumentJsonSchema,
};

export function runArtifactSchema(kind: ArtifactKind, out: OutputPort): number {
  out.log(JSON.stringify(DOCUMENT_JSON_SCHEMAS[kind](), null, 2));
  return 0;
}

interface TransitionSpec {
  readonly name: string;
  readonly description: string;
  readonly target: ArtifactStatus;
  /** Whether the gesture names its arbiter with `--by`. */
  readonly takesBy: boolean;
}

const TRANSITIONS: readonly TransitionSpec[] = [
  {
    name: "approve",
    description: "Transition an artifact to Approved",
    target: "Approved",
    takesBy: true,
  },
  { name: "stale", description: "Manually mark a plan Stale", target: "Stale", takesBy: false },
  {
    name: "abandon",
    description: "Abandon an artifact — terminal; moves the file to its archive/ directory",
    target: "Abandoned",
    takesBy: false,
  },
  {
    name: "complete",
    description: "Complete an artifact — terminal; moves the file to its archive/ directory",
    target: "Completed",
    takesBy: false,
  },
  {
    name: "reopen",
    description: "Reopen an Approved spec or plan, or a Stale plan, back to Draft",
    target: "Draft",
    takesBy: true,
  },
];

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

  artifactCmd
    .command("status")
    .description("Report an artifact's kind, current status, and legal transitions")
    .argument("<path>", "Path to a spec or plan file under docs/specs/ or docs/plans/")
    .action(async (path: string) => {
      const exitCode = await runArtifactStatus(path, out);
      process.exit(exitCode);
    });

  for (const t of TRANSITIONS) {
    const transitionCmd = artifactCmd
      .command(t.name)
      .description(t.description)
      .argument("<path>", "Path to a spec or plan file under docs/specs/ or docs/plans/");
    if (t.takesBy) {
      transitionCmd.option(
        "--by <arbiter>",
        "operator or machine:<grant>; required without a terminal",
      );
    }
    transitionCmd.action(async (path: string, cmdOpts: TransitionFlags) => {
      const exitCode = await runArtifactTransition(path, t.target, out, cmdOpts);
      process.exit(exitCode);
    });
  }

  artifactCmd
    .command("decide")
    .description(
      "Decide a Draft spec's or plan's open questions in an interactive Claude Code session",
    )
    .argument("<path>", "Path to a spec or plan file under docs/specs/ or docs/plans/")
    .option("--question <id>", "Present this question alone: an open one, or re-arbitrate one")
    .option("--doctrine <file>", "Append this doctrine file after the decide skill")
    .option("--model <model>", "Override the decide model (a Claude Code model)")
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

  artifactCmd
    .command("schema")
    .description("Print the JSON Schema of the spec or plan document (experimental)")
    .addArgument(
      new Argument("<kind>", "Document kind: spec or plan").choices(
        Object.keys(DOCUMENT_JSON_SCHEMAS),
      ),
    )
    .action((kind: ArtifactKind) => {
      const exitCode = runArtifactSchema(kind, out);
      process.exit(exitCode);
    });

  artifactCmd
    .command("migrate-approvals")
    .description("Split the old approval ledgers into one record file per artifact (one-time)")
    .action(async () => {
      const exitCode = await runArtifactMigrateApprovals(out);
      process.exit(exitCode);
    });

  artifactCmd
    .command("migrate-documents")
    .description(
      "Rewrite every live spec and plan sidecar below its current shape, re-rendering its body (one-time)",
    )
    .action(async () => {
      const exitCode = await runArtifactMigrateDocuments(out);
      process.exit(exitCode);
    });

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
