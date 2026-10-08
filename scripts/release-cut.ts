// Cuts a release of the schemas package's shapes: sets `version` in
// package.json, npm/package.json and packages/schemas/package.json, renames
// every packages/schemas/snapshots/<format id>/next.schema.json to
// <release>.schema.json, runs schemas-check's write, which regenerates
// PACKAGE_VERSION, FIRST_SUPPORTED_RELEASE, CURRENT_SHAPES and
// src/schemas/release.ts, then appends the release to the release ledger
// packages/schemas/releases.json, from which the docs site serves every
// release's schemas, and rewrites the answer stamps the hello-world example
// prints (audit.mjs's gate-diagnostics, brief.mjs's brief-answer) to the cut
// release. Prints every repo-relative
// path it created, modified or removed, one per line on stdout, so
// scripts/release.sh stages
// exactly those; progress goes to stderr.
// scripts/release.sh calls it. Never run it on the real tree outside a
// release; dry-run it on a copy:
//   pnpm exec tsx scripts/release-cut.ts <X.Y.Z> --root <copy>
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { refreshLock } from "../packages/schemas/build/generated.js";
import { SNAPSHOTS_DIR, snapshotPath } from "../packages/schemas/build/snapshots.js";
import { FORMAT_IDS, compareReleases, isRelease } from "../src/schemas/schemaUrl.js";
import { applySchemasWrite, readSchemasState } from "./schemas-check.js";

const MANIFESTS = ["package.json", "npm/package.json", "packages/schemas/package.json"] as const;

/** A top-level `"version": "…"` line in a 2-space JSON manifest. */
const VERSION_LINE = /^( {2}"version": )"[^"\n]*"/m;

function readVersion(repoRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    readonly version?: unknown;
  };
  if (typeof manifest.version !== "string") throw new Error("package.json has no version");
  return manifest.version;
}

/** `content` with its top-level version set to `version`, every other byte kept. */
function bumpedManifest(path: string, content: string, version: string): string {
  if (!VERSION_LINE.test(content)) throw new Error(`${path} has no top-level "version" line`);
  const bumped = content.replace(VERSION_LINE, `$1${JSON.stringify(version)}`);
  const parsed = JSON.parse(bumped) as { readonly version?: unknown };
  if (parsed.version !== version) throw new Error(`${path}: could not set version to ${version}`);
  return bumped;
}

const LEDGER = "packages/schemas/releases.json";

/**
 * The release ledger's releases. Throws unless it holds a non-empty, strictly
 * increasing list of X.Y.Z releases whose last entry is `current`.
 */
function readLedger(repoRoot: string, current: string): ReadonlyArray<string> {
  const path = join(repoRoot, LEDGER);
  if (!existsSync(path)) throw new Error(`${LEDGER} is missing — nothing cut`);
  let releases: unknown;
  try {
    releases = (JSON.parse(readFileSync(path, "utf8")) as { readonly releases?: unknown } | null)
      ?.releases;
  } catch {
    throw new Error(`${LEDGER} is not JSON — nothing cut`);
  }
  if (
    !Array.isArray(releases) ||
    releases.length === 0 ||
    !releases.every((release) => typeof release === "string" && isRelease(release))
  ) {
    throw new Error(`${LEDGER} must hold { "releases": ["X.Y.Z", …] } — nothing cut`);
  }
  const ledger = releases as ReadonlyArray<string>;
  ledger.forEach((release, index) => {
    const previous = ledger[index - 1];
    if (previous !== undefined && compareReleases(release, previous) <= 0) {
      throw new Error(
        `${LEDGER}: ${release} follows ${previous}, not strictly increasing — nothing cut`,
      );
    }
  });
  if (ledger.at(-1) !== current) {
    throw new Error(
      `${LEDGER}: last entry ${ledger.at(-1)}, package.json version ${current} — nothing cut`,
    );
  }
  return ledger;
}

/** The hello-world scripts that each print one answer `$schema` literal, with its format. */
const EXAMPLE_STAMPS = [
  { path: "examples/hello-world/audit.mjs", format: "gate-diagnostics" },
  { path: "examples/hello-world/brief.mjs", format: "brief-answer" },
] as const;

/** The `$schema` literals of `format`, the release between the two groups. */
function stampPattern(format: string): RegExp {
  return new RegExp(
    `(https://docs\\.phax\\.run/schemas/${format}/)\\d+\\.\\d+\\.\\d+(\\.json)`,
    "g",
  );
}

/**
 * The example script's content. Throws unless the file exists and holds
 * exactly one `format` stamp literal.
 */
function readExampleScript(repoRoot: string, path: string, format: string): string {
  if (!existsSync(join(repoRoot, path))) throw new Error(`${path} is missing — nothing cut`);
  const content = readFileSync(join(repoRoot, path), "utf8");
  const stamps = content.match(stampPattern(format))?.length ?? 0;
  if (stamps !== 1) {
    throw new Error(
      `${path} must hold exactly one ${format} $schema literal, found ${stamps} — nothing cut`,
    );
  }
  return content;
}

/**
 * Cuts `version` on the tree at `repoRoot` and returns every repo-relative
 * path created, modified or removed, sorted. Throws before writing anything
 * when `version` is not `X.Y.Z`, is not newer than the root package.json
 * version, already names a snapshot, the release ledger is missing,
 * unordered or does not end at the current version, a frozen module
 * differs from its lock entry, or an example script is missing or does not
 * hold exactly one stamp: audit.mjs's gate-diagnostics, brief.mjs's
 * brief-answer.
 */
export function cutRelease(repoRoot: string, version: string): { changed: ReadonlyArray<string> } {
  if (!isRelease(version)) throw new Error(`${version} is not a release (X.Y.Z)`);
  const current = readVersion(repoRoot);
  if (compareReleases(version, current) <= 0) {
    throw new Error(`${version} is not newer than package.json version ${current}`);
  }
  for (const id of FORMAT_IDS) {
    const path = snapshotPath(id, version);
    if (existsSync(join(repoRoot, path))) throw new Error(`${path} already exists`);
  }
  const ledger = readLedger(repoRoot, current);
  const state = readSchemasState(repoRoot);
  const { mismatched } = refreshLock(state.lock, state.historyFiles);
  if (mismatched.length > 0) {
    throw new Error(`${mismatched.join(", ")} differ from their lock entries — nothing cut`);
  }
  const manifests = MANIFESTS.map((path) => {
    const content = readFileSync(join(repoRoot, path), "utf8");
    return [path, bumpedManifest(path, content, version)] as const;
  });
  const examples = EXAMPLE_STAMPS.map(
    ({ path, format }) => [path, format, readExampleScript(repoRoot, path, format)] as const,
  );

  const changed = new Set<string>();
  for (const [path, content] of manifests) {
    writeFileSync(join(repoRoot, path), content);
    changed.add(path);
  }
  for (const id of FORMAT_IDS) {
    const from = snapshotPath(id, "next");
    if (!existsSync(join(repoRoot, from))) continue;
    const to = snapshotPath(id, version);
    renameSync(join(repoRoot, from), join(repoRoot, to));
    changed.add(from);
    changed.add(to);
  }
  const written = applySchemasWrite(repoRoot);
  if (written.mismatched.length > 0) {
    throw new Error(`${written.mismatched.join(", ")} differ from their lock entries`);
  }
  for (const path of written.changed) changed.add(path);
  const releases = { releases: [...ledger, version] };
  writeFileSync(join(repoRoot, LEDGER), `${JSON.stringify(releases, null, 2)}\n`);
  changed.add(LEDGER);
  for (const [path, format, content] of examples) {
    writeFileSync(join(repoRoot, path), content.replace(stampPattern(format), `$1${version}$2`));
    changed.add(path);
  }
  return { changed: [...changed].toSorted() };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf("--root");
  const rootArg = rootFlag === -1 ? undefined : args[rootFlag + 1];
  const version = args.find(
    (arg, index) => !arg.startsWith("--") && (rootFlag === -1 || index !== rootFlag + 1),
  );
  try {
    if (rootFlag !== -1 && rootArg === undefined) throw new Error("--root needs a directory");
    if (version === undefined) {
      throw new Error("usage: pnpm exec tsx scripts/release-cut.ts <X.Y.Z> [--root <dir>]");
    }
    const repoRoot =
      rootArg === undefined ? join(fileURLToPath(import.meta.url), "../..") : resolve(rootArg);
    console.error(`cutting ${version} in ${repoRoot} (${SNAPSHOTS_DIR})`);
    const { changed } = cutRelease(repoRoot, version);
    for (const path of changed) process.stdout.write(`${path}\n`);
    console.error(`cut ${version}: ${changed.length} paths changed`);
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
