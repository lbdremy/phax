import { execSync } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Effect, Either, Layer } from "effect";
import type { Command } from "commander";
import type { OutputPort } from "../../ports/output.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { FileSystem } from "../../ports/fs.js";
import { Git } from "../../ports/git.js";
import { inspectArtifact, transitionArtifact } from "../../app/artifactStatus.js";
import type { ArtifactStatus } from "../../domain/artifact/status.js";
import { exitCodeForError } from "./runLayers.js";

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
// as absolute or cwd-relative on the command line is normalized here.
function toRepoRelativePath(pathArg: string): string {
  const cwd = process.cwd();
  const absolute = isAbsolute(pathArg) ? pathArg : resolve(cwd, pathArg);
  const repoRoot = findGitRoot(cwd);
  const rel = relative(repoRoot, absolute);
  return rel.split(sep).join("/");
}

function buildLayer(): Layer.Layer<FileSystem | Git> {
  return Layer.merge(NodeFileSystemLayer, makeNodeGitLayer());
}

export async function runArtifactStatus(pathArg: string, out: OutputPort): Promise<number> {
  const repoRelPath = toRepoRelativePath(pathArg);
  const effect = inspectArtifact(repoRelPath).pipe(Effect.provide(buildLayer()));
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return exitCodeForError(result.left);
  }

  const { kind, status, legalTargets } = result.right;
  out.log(`Path:              ${repoRelPath}`);
  out.log(`Kind:              ${kind}`);
  out.log(`Status:            ${status}`);
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
  const repoRelPath = toRepoRelativePath(pathArg);
  const repoRoot = findGitRoot(process.cwd());
  const opts = { repoRoot, nowIso: new Date().toISOString(), commit: true };
  const effect = transitionArtifact(repoRelPath, target, opts).pipe(Effect.provide(buildLayer()));
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return exitCodeForError(result.left);
  }

  const { status, path, approvedBaseline } = result.right;
  out.log(`Status: ${status}`);
  if (target === "Abandoned" || target === "Archived") {
    out.log(`Path:   ${path}`);
  }
  if (approvedBaseline !== undefined) {
    out.log(`Baseline: ${approvedBaseline.slice(0, 7)}`);
  }
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
    name: "archive",
    description: "Archive an artifact — terminal; moves the file to its archive/ directory",
    target: "Archived",
  },
  { name: "reopen", description: "Reopen a Stale plan back to Draft", target: "Draft" },
];

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
}
