// Reads what a release's runs delivered and writes the release notes from it.
// The runs are the Run-Id and Short-Name trailers of the commits since the
// previous release's tag, matched to the plans completed in the same range;
// each plan that completes its spec leads to that spec, whose sidecar holds the
// guiding rule and the surfaces; a plan with completes-spec: false is work in
// progress, announced nowhere and its spec never read, though its run's commits
// still stay out of the commit lists. scripts/releaseNotes.ts renders the facts
// gathered here.
// Reads git and the files under the root and writes nothing; progress and
// warnings go to stderr. Previews the opened version's notes:
//   pnpm release:notes [--root <dir>]
// and prints the GitHub release body of a notes file, its path relative to
// the current directory:
//   pnpm exec tsx scripts/release-notes.ts --github-body docs/releases/<X.Y.Z>.md
// scripts/release-cut.ts calls releaseNotes at the cut and writes the result.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { slugifyShortName } from "../src/domain/branded.js";
import { archivePathFor, isRepoSpecPath } from "../src/domain/artifact/document.js";
import { readPlanFrontmatter } from "../src/domain/artifact/lineage.js";
import { artifactBody, sidecarPathFor } from "../src/domain/artifact/sidecar.js";
import { readDocumentSidecar } from "../src/schemas/persisted.js";
import { compareReleases } from "../src/schemas/schemaUrl.js";
import { readLedger, readVersion } from "./release-cut.js";
import {
  githubReleaseBody,
  renderReleaseNotes,
  type ReleaseCommit,
  type ReleaseNotes,
  type ReleaseNotesInput,
  type ReleasePlan,
  type ReleaseSpec,
} from "./releaseNotes.js";

export const REPOSITORY = "https://github.com/lbdremy/phax";

const UPGRADING = "docs/upgrading.md";

/** One commit of the range; `runId` and `shortName` are the first value of the trailer, if any. */
export interface LogRecord {
  readonly hash: string;
  readonly subject: string;
  readonly runId: string | null;
  readonly shortName: string | null;
}

/** The `git log` format `parseLog` reads: git parses the trailers, the script never reads a body. */
export const LOG_FORMAT =
  "%H%x1f%s%x1f%(trailers:key=Run-Id,valueonly,separator=%x1d)%x1f%(trailers:key=Short-Name,valueonly,separator=%x1d)%x1e";

function firstValue(field: string | undefined): string | null {
  const value = (field ?? "").split("\x1d")[0]?.trim() ?? "";
  return value === "" ? null : value;
}

/**
 * The commits of `git log --reverse --no-merges --format=<LOG_FORMAT> <range>`,
 * oldest first. Every record after the first starts with the newline git
 * writes after the format; a trailer key that appears twice keeps its first
 * value.
 */
export function parseLog(text: string): ReadonlyArray<LogRecord> {
  return text
    .split("\x1e")
    .map((record, index) => (index === 0 ? record : record.replace(/^\n/, "")))
    .filter((record) => record !== "")
    .map((record) => {
      const [hash = "", subject = "", runId, shortName] = record.split("\x1f");
      return { hash, subject, runId: firstValue(runId), shortName: firstValue(shortName) };
    });
}

function runGit(repoRoot: string, args: ReadonlyArray<string>): { status: number; out: string } {
  const result = spawnSync("git", [...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) return { status: 0, out: result.stdout };
  return { status: result.status ?? 1, out: result.stderr };
}

function git(repoRoot: string, args: ReadonlyArray<string>): string {
  const { status, out } = runGit(repoRoot, args);
  if (status !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.trim()}`);
  return out;
}

/** The first level-1 heading's text and the source of the first paragraph after it. */
function titleAndLede(body: string): { title: string | null; firstParagraph: string } {
  const tree = fromMarkdown(body);
  const at = tree.children.findIndex((node) => node.type === "heading" && node.depth === 1);
  const heading = tree.children[at];
  if (heading === undefined) return { title: null, firstParagraph: "" };
  const paragraph = tree.children.slice(at + 1).find((node) => node.type === "paragraph");
  const start = paragraph?.position?.start.offset;
  const end = paragraph?.position?.end.offset;
  return {
    title: toString(heading),
    firstParagraph: start === undefined || end === undefined ? "" : body.slice(start, end),
  };
}

/** The parsed sidecar of the document at `mdPath`, or null when it has none. */
function readSidecarJson(repoRoot: string, mdPath: string): { path: string; json: unknown } | null {
  const path = sidecarPathFor(mdPath);
  const absolute = join(repoRoot, path);
  if (!existsSync(absolute)) return null;
  try {
    return { path, json: JSON.parse(readFileSync(absolute, "utf8")) as unknown };
  } catch {
    throw new Error(`${path}: not JSON`);
  }
}

interface CompletedPlan {
  readonly plan: Omit<ReleasePlan, "spec">;
  readonly sourceSpec: { readonly path: string; readonly completesSpec: boolean } | null;
  readonly shortName: string;
}

/** A completed plan archived in the range, or null when its status is anything else. */
function readCandidate(repoRoot: string, path: string): CompletedPlan | null {
  const md = readFileSync(join(repoRoot, path), "utf8");
  const frontmatter = readPlanFrontmatter(md);
  if (frontmatter.kind === "none") throw new Error(`${path}: no frontmatter`);
  if (frontmatter.kind === "undecodable") throw new Error(`${path}: ${frontmatter.problem}`);
  if (frontmatter.status !== "Completed") return null;
  const { title, firstParagraph } = titleAndLede(artifactBody(md));
  if (title === null) throw new Error(`${path}: no "# " title`);
  const sidecar = readSidecarJson(repoRoot, path);
  let shortName = slugifyShortName(title);
  if (sidecar !== null) {
    const read = readDocumentSidecar("plan", sidecar.path, sidecar.json);
    if (Either.isLeft(read)) throw new Error(read.left.message);
    const { run } = read.right.shape === "current" ? read.right.document : read.right.older;
    shortName = slugifyShortName(run.shortName) || slugifyShortName(run.title) || "run";
  }
  return {
    plan: { path, title, firstParagraph },
    sourceSpec:
      frontmatter.sourceSpec.kind === "spec"
        ? { path: frontmatter.sourceSpec.path, completesSpec: frontmatter.sourceSpec.completesSpec }
        : null,
    shortName,
  };
}

/** The spec a plan names, at its path or in the archive; warns once when it has no sidecar. */
function readSpec(
  repoRoot: string,
  planPath: string,
  declared: string,
  warnings: string[],
  cache: Map<string, ReleaseSpec>,
): ReleaseSpec {
  let archived: string;
  try {
    if (!isRepoSpecPath(declared)) throw new Error("not a spec path");
    archived = archivePathFor(declared);
  } catch {
    throw new Error(`${planPath}: source-spec ${declared} is not a spec path`);
  }
  const path = [declared, archived].find((candidate) => existsSync(join(repoRoot, candidate)));
  if (path === undefined) {
    throw new Error(
      `${planPath}: its source spec ${declared} is in neither docs/specs/ nor docs/specs/archive/`,
    );
  }
  const known = cache.get(path);
  if (known !== undefined) return known;
  const sidecar = readSidecarJson(repoRoot, path);
  let spec: ReleaseSpec;
  if (sidecar === null) {
    const { title } = titleAndLede(artifactBody(readFileSync(join(repoRoot, path), "utf8")));
    if (title === null) throw new Error(`${path}: no "# " title`);
    warnings.push(`${path} has no sidecar: it is announced by its title alone`);
    spec = { path, title, guidingRule: null, surface: [] };
  } else {
    const read = readDocumentSidecar("spec", sidecar.path, sidecar.json);
    if (Either.isLeft(read)) throw new Error(read.left.message);
    const { document } = read.right;
    spec = {
      path,
      title: document.title,
      guidingRule: document.productGoal.guidingRule,
      surface: document.surface.map(({ surface, summary, before, after }) => ({
        surface,
        summary,
        before,
        after,
      })),
    };
  }
  cache.set(path, spec);
  return spec;
}

/**
 * The facts the notes of `version` are written from, and the warnings found
 * on the way. Throws an `Error` naming the file or the remedy when an input
 * is wrong.
 */
export function collectReleaseNotes(
  repoRoot: string,
  version: string,
): { input: ReleaseNotesInput; warnings: ReadonlyArray<string> } {
  const warnings: string[] = [];
  const previous = readLedger(repoRoot, "no release notes")
    .filter((release) => compareReleases(release, version) < 0)
    .at(-1);
  if (previous === undefined) {
    throw new Error(
      `no release below ${version} in packages/schemas/releases.json — no release notes`,
    );
  }
  const tag = `refs/tags/v${previous}`;
  if (runGit(repoRoot, ["rev-parse", "--verify", "--quiet", tag]).status !== 0) {
    throw new Error(
      `v${previous} is not a tag in ${repoRoot} — fetch the tags (git fetch --tags), or clone with the full history`,
    );
  }
  const log = parseLog(
    git(repoRoot, ["log", "--reverse", "--no-merges", `--format=${LOG_FORMAT}`, `${tag}..HEAD`]),
  );

  const archived = git(repoRoot, [
    "diff",
    "--name-only",
    "--no-renames",
    "--diff-filter=A",
    tag,
    "HEAD",
    "--",
    "docs/plans/archive",
  ])
    .split("\n")
    .filter((path) => path.endsWith("-plan.md"));
  const candidates: CompletedPlan[] = [];
  for (const path of archived) {
    const candidate = readCandidate(repoRoot, path);
    if (candidate !== null) candidates.push(candidate);
  }
  const byShortName = new Map<string, CompletedPlan>();
  for (const candidate of candidates) {
    const other = byShortName.get(candidate.shortName);
    if (other !== undefined) {
      throw new Error(
        `${other.plan.path} and ${candidate.plan.path} both have the run short name ${candidate.shortName}`,
      );
    }
    byShortName.set(candidate.shortName, candidate);
  }

  // The runs, in order of their first commit.
  const runNames: string[] = [];
  for (const record of log) {
    if (
      record.runId !== null &&
      record.shortName !== null &&
      !runNames.includes(record.shortName)
    ) {
      runNames.push(record.shortName);
    }
  }
  const matched = runNames.flatMap((name) => {
    const candidate = byShortName.get(name);
    return candidate === undefined ? [] : [candidate];
  });
  for (const name of runNames) {
    if (!byShortName.has(name)) {
      warnings.push(
        `run ${name} names no plan completed since v${previous}: its commits are listed as commits without a run`,
      );
    }
  }
  const commits: ReleaseCommit[] = [];
  for (const record of log) {
    const { shortName } = record;
    const inRun = shortName !== null && runNames.includes(shortName);
    if (shortName !== null && record.runId === null && !inRun) {
      warnings.push(
        `${record.hash.slice(0, 7)}: Short-Name ${shortName} names no run since v${previous}: it is listed as a commit without a run`,
      );
    }
    if (inRun && byShortName.has(shortName)) continue;
    commits.push({ hash: record.hash, subject: record.subject });
  }
  for (const candidate of candidates) {
    if (!runNames.includes(candidate.shortName)) {
      warnings.push(
        `${candidate.plan.path} was completed since v${previous}, but no run commit names ${candidate.shortName}: it is not announced`,
      );
    }
  }

  // Only the plans the release announces reach the builder: a plan with
  // completes-spec: false is work in progress, and its spec is never read.
  const specs = new Map<string, ReleaseSpec>();
  const plans: ReleasePlan[] = matched.flatMap(({ plan, sourceSpec }): ReleasePlan[] => {
    if (sourceSpec === null) return [{ ...plan, spec: null }];
    if (!sourceSpec.completesSpec) return [];
    return [{ ...plan, spec: readSpec(repoRoot, plan.path, sourceSpec.path, warnings, specs) }];
  });

  if (!existsSync(join(repoRoot, UPGRADING))) throw new Error(`${UPGRADING} is missing`);
  const upgrading = readFileSync(join(repoRoot, UPGRADING), "utf8");
  return {
    input: { version, previous, repository: REPOSITORY, upgrading, plans, commits },
    warnings,
  };
}

/** The notes of `version`: the collector's warnings first, the renderer's after them. */
export function releaseNotes(repoRoot: string, version: string): ReleaseNotes {
  const { input, warnings } = collectReleaseNotes(repoRoot, version);
  const rendered = renderReleaseNotes(input);
  return { markdown: rendered.markdown, warnings: [...warnings, ...rendered.warnings] };
}

/** The GitHub release body of the notes file at `file` (relative to `cwd`, named X.Y.Z.md). */
export function githubBodyOf(cwd: string, file: string): string {
  const version = /^(\d+\.\d+\.\d+)\.md$/.exec(basename(file))?.[1];
  if (version === undefined) throw new Error(`${file}: a release notes file is named X.Y.Z.md`);
  const absolute = resolve(cwd, file);
  if (!existsSync(absolute)) throw new Error(`${file} is missing`);
  return githubReleaseBody(readFileSync(absolute, "utf8"), version);
}

export const USAGE =
  "usage: pnpm release:notes [--root <dir>], or pnpm exec tsx scripts/release-notes.ts --github-body <file>";

/** What the command line asks for; refuses anything but the two forms of `USAGE`. */
export type Command =
  | { readonly kind: "notes"; readonly root: string | null }
  | { readonly kind: "github-body"; readonly file: string };

export function parseArguments(args: ReadonlyArray<string>): Command {
  const values = new Map<string, string>();
  for (let at = 0; at < args.length; at += 2) {
    const flag = args[at] ?? "";
    const value = args[at + 1];
    if ((flag !== "--root" && flag !== "--github-body") || values.has(flag)) {
      throw new Error(`unexpected argument ${flag} — ${USAGE}`);
    }
    if (value === undefined) throw new Error(`${flag} needs a value — ${USAGE}`);
    values.set(flag, value);
  }
  const file = values.get("--github-body");
  const root = values.get("--root") ?? null;
  if (file === undefined) return { kind: "notes", root };
  if (root !== null) throw new Error(`--github-body takes no --root — ${USAGE}`);
  return { kind: "github-body", file };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const command = parseArguments(process.argv.slice(2));
    if (command.kind === "github-body") {
      process.stdout.write(githubBodyOf(process.cwd(), command.file));
    } else {
      const repoRoot =
        command.root === null
          ? join(fileURLToPath(import.meta.url), "../..")
          : resolve(command.root);
      const version = readVersion(repoRoot);
      console.error(`release notes of ${version} in ${repoRoot}`);
      const { markdown, warnings } = releaseNotes(repoRoot, version);
      for (const warning of warnings) console.error(`! ${warning}`);
      process.stdout.write(markdown);
    }
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
