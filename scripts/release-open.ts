// Opens a version: sets `version` in package.json, npm/package.json and
// packages/schemas/package.json, then runs schemas-check's write, which
// regenerates PACKAGE_VERSION, PHAX_RELEASE and CURRENT_STAMPS (a format's
// `next` snapshot is stamped with the opened version). The release ledger and
// the snapshots are never touched: an opened version is never served nor
// tagged until scripts/release-cut.ts cuts it. Prints every repo-relative
// path it changed, one per line on stdout, so scripts/release.sh stages
// exactly those; progress goes to stderr.
// scripts/release.sh calls it after a release and for --open. Never run it on
// the real tree by hand; dry-run it on a copy:
//   pnpm exec tsx scripts/release-open.ts <X.Y.Z> --root <copy>
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { refreshLock } from "../packages/schemas/build/generated.js";
import { compareReleases, isRelease } from "../src/schemas/schemaUrl.js";
import { MANIFESTS, bumpedManifest, readLedger, readVersion } from "./release-cut.js";
import { applySchemasWrite, readSchemasState } from "./schemas-check.js";

/**
 * Opens `version` on the tree at `repoRoot` and returns every repo-relative
 * path it changed, sorted. Throws before writing anything when `version` is
 * not `X.Y.Z`, the release ledger is missing, malformed or unordered,
 * `version` is not newer than the ledger's last entry, the manifests already
 * name it, or a frozen module differs from its lock entry.
 */
export function openRelease(repoRoot: string, version: string): { changed: ReadonlyArray<string> } {
  if (!isRelease(version)) throw new Error(`${version} is not a release (X.Y.Z)`);
  const ledger = readLedger(repoRoot, "nothing opened");
  const last = ledger.at(-1)!;
  if (compareReleases(version, last) <= 0) {
    throw new Error(`${version} is not newer than the last release ${last} — nothing opened`);
  }
  if (readVersion(repoRoot) === version) {
    throw new Error(`${version} is already the opened version — nothing opened`);
  }
  const state = readSchemasState(repoRoot);
  const { mismatched } = refreshLock(state.lock, state.historyFiles);
  if (mismatched.length > 0) {
    throw new Error(`${mismatched.join(", ")} differ from their lock entries — nothing opened`);
  }
  const manifests = MANIFESTS.map((path) => {
    const content = readFileSync(join(repoRoot, path), "utf8");
    return [path, content, bumpedManifest(path, content, version)] as const;
  });

  const changed = new Set<string>();
  for (const [path, content, bumped] of manifests) {
    if (bumped === content) continue;
    writeFileSync(join(repoRoot, path), bumped);
    changed.add(path);
  }
  const written = applySchemasWrite(repoRoot);
  if (written.mismatched.length > 0) {
    throw new Error(`${written.mismatched.join(", ")} differ from their lock entries`);
  }
  for (const path of written.changed) changed.add(path);
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
      throw new Error("usage: pnpm exec tsx scripts/release-open.ts <X.Y.Z> [--root <dir>]");
    }
    const repoRoot =
      rootArg === undefined ? join(fileURLToPath(import.meta.url), "../..") : resolve(rootArg);
    console.error(`opening ${version} in ${repoRoot}`);
    const { changed } = openRelease(repoRoot, version);
    for (const path of changed) process.stdout.write(`${path}\n`);
    console.error(`opened ${version}: ${changed.length} paths changed`);
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
