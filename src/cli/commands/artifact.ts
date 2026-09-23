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
  inspectArtifact,
  transitionArtifact,
} from "../../app/artifactStatus.js";
import { createArtifact } from "../../app/createArtifact.js";
import { authorArtifact, recordWarning } from "../../app/authorArtifact.js";
import { loadConfig } from "../../app/loadConfig.js";
import { recordsClonePath } from "../../app/recordsSync.js";
import { loadModelRouting, loadProviderConfig } from "../../app/loadRouting.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { resolveModel } from "../../domain/routing/resolve.js";
import type { ArtifactKind, ArtifactStatus } from "../../domain/artifact/status.js";
import { getPlanDocumentJsonSchema } from "../../schemas/planDocument.js";
import { getSpecDocumentJsonSchema } from "../../schemas/specDocument.js";
import { resolveAuthoringSelection, type Effort } from "../../schemas/phaxConfig.js";
import { defaultBundleRoot } from "./skills.js";
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

function buildLayer(repoRoot: string): Layer.Layer<FileSystem | Git> {
  return Layer.merge(makeRootedNodeFileSystemLayer(repoRoot), makeNodeGitLayer());
}

function authoringText(authoring: ArtifactAuthoring): string {
  if (authoring.kind === "interactive") return "interactive (no sidecar)";
  const { agreement, sidecarPath } = authoring;
  const state =
    agreement === "in-sync"
      ? "in sync"
      : agreement === "diverged"
        ? "diverged — body differs from the sidecar's rendering"
        : `invalid sidecar — ${agreement.message}`;
  return `headless — sidecar ${sidecarPath} (${state})`;
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

  const { kind, status, legalTargets, approval, authoring } = result.right;
  out.log(`Path:              ${repoRelPath}`);
  out.log(`Kind:              ${kind}`);
  out.log(`Status:            ${status}`);
  out.log(`Authored:          ${authoringText(authoring)}`);
  if (approval.kind === "recorded") {
    out.log(`Approved:          ${approval.date} @ ${approval.baseline}`);
    out.log(`Edited since:      ${approval.editedSinceApproval ? "yes" : "no"}`);
  } else if (approval.kind === "unrecorded") {
    out.log(`Approved:          (unrecorded — run phax artifact approve to record)`);
  }
  out.log(
    `Legal transitions: ${legalTargets.length > 0 ? legalTargets.join(", ") : "(none — terminal)"}`,
  );
  return 0;
}

export async function runArtifactTransition(
  pathArg: string,
  target: ArtifactStatus,
  out: OutputPort,
): Promise<number> {
  const repoRoot = findGitRoot(process.cwd());
  const repoRelPath = toRepoRelativePath(pathArg, repoRoot);
  const opts = { repoRoot, nowIso: new Date().toISOString(), commit: true };
  const effect = transitionArtifact(repoRelPath, target, opts).pipe(
    Effect.provide(buildLayer(repoRoot)),
  );
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return exitCodeForError(result.left);
  }

  const { status, path, approvedBaseline, commit: madeCommit } = result.right;
  out.log(`Status: ${status}`);
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

export async function runCreateArtifact(
  kind: ArtifactKind,
  slug: string,
  sourceSpecArg: string | undefined,
  out: OutputPort,
): Promise<number> {
  const repoRoot = findGitRoot(process.cwd());
  const sourceSpec =
    sourceSpecArg === undefined ? null : toRepoRelativePath(sourceSpecArg, repoRoot);
  const input = { kind, slug, sourceSpec, nowIso: new Date().toISOString(), repoRoot };
  const effect = createArtifact(input).pipe(
    Effect.provide(makeRootedNodeFileSystemLayer(repoRoot)),
  );
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return exitCodeForError(result.left);
  }

  const { path, sourceSpec: boundSpec } = result.right;
  if (kind === "spec") {
    out.log(`created ${path} (Draft)`);
  } else {
    out.log(`created ${path} (Draft, source-spec ${boundSpec ?? "null"})`);
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

  const { path, sidecarPath, commit, record } = result.right;
  out.log(`created ${path} (Draft, headless)`);
  out.log(`sidecar ${sidecarPath}`);
  out.log(`commit ${commit.hash.slice(0, 7)} — ${commit.subject}`);
  if (record.kind === "written") out.log(`record ${record.key}`);
  else if (record.kind === "records-off") out.log("record off");
  else out.warn(recordWarning(record) ?? "authoring record not written");
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
}

const TRANSITIONS: readonly TransitionSpec[] = [
  { name: "approve", description: "Transition an artifact to Approved", target: "Approved" },
  { name: "stale", description: "Manually mark a plan Stale", target: "Stale" },
  {
    name: "abandon",
    description: "Abandon an artifact — terminal; moves the file to its archive/ directory",
    target: "Abandoned",
  },
  {
    name: "complete",
    description: "Complete an artifact — terminal; moves the file to its archive/ directory",
    target: "Completed",
  },
  { name: "reopen", description: "Reopen a Stale plan back to Draft", target: "Draft" },
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
    artifactCmd
      .command(t.name)
      .description(t.description)
      .argument("<path>", "Path to a spec or plan file under docs/specs/ or docs/plans/")
      .action(async (path: string) => {
        const exitCode = await runArtifactTransition(path, t.target, out);
        process.exit(exitCode);
      });
  }

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
        ? await runCreateArtifactHeadless("spec", slug, undefined, cmdOpts, out)
        : await runCreateArtifact("spec", slug, undefined, out);
      process.exit(exitCode);
    });

  newCmd
    .command("plan")
    .description("Create a Draft plan at docs/plans/<YYMMDDHHMM>-<slug>-plan.md")
    .argument("<slug>", "Slug matching `[a-z0-9]+(-[a-z0-9]+)*`")
    .option("--spec <path>", "Path to the source spec to bind as source-spec")
    .option(
      "--headless",
      "Author via a recorded agent session from a brief instead of a blank skeleton (experimental)",
    )
    .option("--brief <file|->", "Path to a brief file, or - to read the brief from stdin")
    .option("--model <model>", "Override the authoring model (default: flag → config → catalog)")
    .option("--effort <effort>", "Override the authoring effort (low|medium|high)")
    .action(async (slug: string, cmdOpts: { spec?: string } & HeadlessArtifactOptions) => {
      const exitCode = cmdOpts.headless
        ? await runCreateArtifactHeadless("plan", slug, cmdOpts.spec, cmdOpts, out)
        : await runCreateArtifact("plan", slug, cmdOpts.spec, out);
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
