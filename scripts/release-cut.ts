// Cuts the opened release of the schemas package's shapes. Between releases
// package.json, npm/package.json and packages/schemas/package.json name the
// opened version, and the cut accepts only that version. It renames every
// packages/schemas/snapshots/<format id>/next.schema.json to
// <release>.schema.json, runs schemas-check's write, which regenerates
// CURRENT_SHAPES and FIRST_SUPPORTED_RELEASE (PACKAGE_VERSION, PHAX_RELEASE
// and CURRENT_STAMPS already name the opened version), then appends the
// release to the release ledger packages/schemas/releases.json, from which
// the docs site serves every release's schemas. It changes no manifest,
// stamp or example. Prints every repo-relative path it created, modified or
// removed, one per line on stdout, so scripts/release.sh stages exactly
// those; progress goes to stderr.
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

/** The manifests whose top-level version names the opened version. */
export const MANIFESTS = [
  "package.json",
  "npm/package.json",
  "packages/schemas/package.json",
] as const;

/** A top-level `"version": "…"` line in a 2-space JSON manifest. */
const VERSION_LINE = /^( {2}"version": )"[^"\n]*"/m;

/** The root package.json version: the opened version between releases. */
export function readVersion(repoRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    readonly version?: unknown;
  };
  if (typeof manifest.version !== "string") throw new Error("package.json has no version");
  return manifest.version;
}

/** `content` with its top-level version set to `version`, every other byte kept. */
export function bumpedManifest(path: string, content: string, version: string): string {
  if (!VERSION_LINE.test(content)) throw new Error(`${path} has no top-level "version" line`);
  const bumped = content.replace(VERSION_LINE, `$1${JSON.stringify(version)}`);
  const parsed = JSON.parse(bumped) as { readonly version?: unknown };
  if (parsed.version !== version) throw new Error(`${path}: could not set version to ${version}`);
  return bumped;
}

export const LEDGER = "packages/schemas/releases.json";

/**
 * The release ledger's releases. Throws unless it holds a non-empty, strictly
 * increasing list of X.Y.Z releases; each message ends in `— <nothing>`, e.g.
 * `— nothing cut`.
 */
export function readLedger(repoRoot: string, nothing: string): ReadonlyArray<string> {
  const path = join(repoRoot, LEDGER);
  if (!existsSync(path)) throw new Error(`${LEDGER} is missing — ${nothing}`);
  let releases: unknown;
  try {
    releases = (JSON.parse(readFileSync(path, "utf8")) as { readonly releases?: unknown } | null)
      ?.releases;
  } catch {
    throw new Error(`${LEDGER} is not JSON — ${nothing}`);
  }
  if (
    !Array.isArray(releases) ||
    releases.length === 0 ||
    !releases.every((release) => typeof release === "string" && isRelease(release))
  ) {
    throw new Error(`${LEDGER} must hold { "releases": ["X.Y.Z", …] } — ${nothing}`);
  }
  const ledger = releases as ReadonlyArray<string>;
  ledger.forEach((release, index) => {
    const previous = ledger[index - 1];
    if (previous !== undefined && compareReleases(release, previous) <= 0) {
      throw new Error(
        `${LEDGER}: ${release} follows ${previous}, not strictly increasing — ${nothing}`,
      );
    }
  });
  return ledger;
}

/**
 * Cuts `version` on the tree at `repoRoot` and returns every repo-relative
 * path created, modified or removed, sorted. Throws before writing anything
 * when `version` is not `X.Y.Z`, is not the opened version package.json
 * names, already names a snapshot, the release ledger is missing, malformed
 * or unordered, the ledger's last entry is not below `version`, or a frozen
 * module differs from its lock entry.
 */
export function cutRelease(repoRoot: string, version: string): { changed: ReadonlyArray<string> } {
  if (!isRelease(version)) throw new Error(`${version} is not a release (X.Y.Z)`);
  const opened = readVersion(repoRoot);
  if (version !== opened) {
    throw new Error(
      `${version} is not the opened version ${opened} — re-open first: scripts/release.sh --open ${version}`,
    );
  }
  for (const id of FORMAT_IDS) {
    const path = snapshotPath(id, version);
    if (existsSync(join(repoRoot, path))) throw new Error(`${path} already exists`);
  }
  const ledger = readLedger(repoRoot, "nothing cut");
  const last = ledger.at(-1)!;
  if (compareReleases(version, last) <= 0) {
    throw new Error(`${version} is not newer than the last release ${last} — nothing cut`);
  }
  const state = readSchemasState(repoRoot);
  const { mismatched } = refreshLock(state.lock, state.historyFiles);
  if (mismatched.length > 0) {
    throw new Error(`${mismatched.join(", ")} differ from their lock entries — nothing cut`);
  }

  const changed = new Set<string>();
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
