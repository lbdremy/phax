// Checks the schemas package's derived files against their sources:
// packages/schemas/src/generated/index.ts against the root package.json
// version, the lowest release-named snapshot and every format's current shape
// name (`next`, else its highest release-named snapshot), phax's src/schemas/release.ts
// (PHAX_RELEASE) against the root package.json version, packages/schemas/history.lock.json
// against the bytes of every frozen module under phax's src/schemas/history/
// (keyed by repo-relative path), and every format's JSON Schema snapshots
// under packages/schemas/snapshots/<format id>/ against the schema its
// current decoder renders. `--write` is `applySchemasWrite(root)`, which the
// release cut (scripts/release-cut.ts) also runs on the tree it cuts.
// Check: pnpm exec tsx scripts/schemas-check.ts
// Write: pnpm exec tsx scripts/schemas-check.ts --write
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WRITE_COMMAND,
  refreshLock,
  renderGeneratedIndex,
  renderLock,
  renderReleaseModule,
  type HistoryLock,
} from "../packages/schemas/build/generated.js";
import {
  FORMAT_DEFINITIONS,
  JSON_SCHEMA_FORMATS,
  renderJsonSchemas,
} from "../packages/schemas/build/jsonSchemas.js";
import {
  SNAPSHOTS_DIR,
  checkSnapshots,
  currentShapeNames,
  firstSupportedRelease,
  planSnapshotWrites,
  type SnapshotFormat,
} from "../packages/schemas/build/snapshots.js";
import { FORMAT_IDS, type FormatId } from "../src/schemas/schemaUrl.js";

const PACKAGE_DIR = "packages/schemas";
const GENERATED_INDEX = "src/generated/index.ts";
const HISTORY_DIR = "src/schemas/history";
const LOCK_FILE = "history.lock.json";
const LOCK_PATH = `${PACKAGE_DIR}/${LOCK_FILE}`;
const RELEASE_MODULE = "src/schemas/release.ts";

/** Everything the check reads, so it can run on an injected state. */
export interface SchemasState {
  readonly packageVersion: string;
  /** The lowest release-named snapshot across every format, or null when none exists. */
  readonly firstSupportedRelease: string | null;
  /** Format id → current shape name the snapshots record (`currentShapeNames`). */
  readonly currentShapes: Readonly<Partial<Record<FormatId, string>>>;
  /** The committed generated index, or undefined when absent. */
  readonly generatedIndex: string | undefined;
  /** The committed `src/schemas/release.ts`, or undefined when absent. */
  readonly releaseModule: string | undefined;
  readonly lock: HistoryLock;
  /** Repo-relative path → bytes, for every module under `src/schemas/history/`. */
  readonly historyFiles: ReadonlyMap<string, Uint8Array>;
  /** Directory name under `packages/schemas/snapshots` → file name → content. */
  readonly snapshots: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** The names of the files directly under `packages/schemas/snapshots`. */
  readonly snapshotRootFiles: ReadonlyArray<string>;
  /** Every format id's current shape name and rendered JSON Schema. */
  readonly formats: ReadonlyArray<SnapshotFormat>;
}

function readSnapshots(root: string): Pick<SchemasState, "snapshots" | "snapshotRootFiles"> {
  const snapshots = new Map<string, Map<string, string>>();
  if (!existsSync(root)) return { snapshots, snapshotRootFiles: [] };
  const entries = readdirSync(root, { withFileTypes: true });
  const snapshotRootFiles = entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  const dirs = entries.filter((entry) => entry.isDirectory());
  for (const dir of dirs.map((entry) => entry.name).toSorted()) {
    const files = new Map<string, string>();
    for (const file of listFiles(join(root, dir)).toSorted()) {
      files.set(relative(join(root, dir), file).split("\\").join("/"), readFileSync(file, "utf8"));
    }
    snapshots.set(dir, files);
  }
  return { snapshots, snapshotRootFiles };
}

function renderFormats(): SnapshotFormat[] {
  const { files, failures } = renderJsonSchemas(JSON_SCHEMA_FORMATS);
  return FORMAT_IDS.map((id): SnapshotFormat => {
    const content = files.get(`${id}.schema.json`);
    const failure = failures.find((entry) => entry.format === id);
    return {
      id,
      currentShape: FORMAT_DEFINITIONS[id].current.name,
      releasedShapes: FORMAT_DEFINITIONS[id].releases.map(([name]) => name),
      generated:
        content !== undefined
          ? { ok: true, content }
          : { ok: false, reason: failure?.reason ?? "no JSON Schema rendered" },
    };
  });
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(root, entry.name)) : [join(root, entry.name)],
  );
}

export function readSchemasState(repoRoot: string): SchemasState {
  const packageDir = join(repoRoot, PACKAGE_DIR);
  const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    version: string;
  };
  const indexPath = join(packageDir, GENERATED_INDEX);
  const lockPath = join(packageDir, LOCK_FILE);
  const releasePath = join(repoRoot, RELEASE_MODULE);
  const historyFiles = new Map<string, Uint8Array>();
  for (const file of listFiles(join(repoRoot, HISTORY_DIR)).toSorted()) {
    historyFiles.set(relative(repoRoot, file).split("\\").join("/"), readFileSync(file));
  }
  const snapshots = readSnapshots(join(repoRoot, SNAPSHOTS_DIR));
  return {
    packageVersion: rootManifest.version,
    firstSupportedRelease: firstSupportedRelease(snapshots.snapshots),
    currentShapes: currentShapeNames(snapshots.snapshots).names,
    generatedIndex: existsSync(indexPath) ? readFileSync(indexPath, "utf8") : undefined,
    releaseModule: existsSync(releasePath) ? readFileSync(releasePath, "utf8") : undefined,
    lock: existsSync(lockPath) ? (JSON.parse(readFileSync(lockPath, "utf8")) as HistoryLock) : {},
    historyFiles,
    ...snapshots,
    formats: renderFormats(),
  };
}

function generatedIndexOf(
  state: SchemasState,
  currentShapes: SchemasState["currentShapes"] = state.currentShapes,
): string {
  return renderGeneratedIndex({
    packageVersion: state.packageVersion,
    firstSupportedRelease: state.firstSupportedRelease,
    currentShapes,
  });
}

/** `next (registry, run-status)`, or `next for every format` when they all agree. */
function describeCurrentShapes(currentShapes: SchemasState["currentShapes"]): string {
  const byName = new Map<string, FormatId[]>();
  for (const id of FORMAT_IDS) {
    const name = currentShapes[id];
    if (name !== undefined) byName.set(name, [...(byName.get(name) ?? []), id]);
  }
  const groups = [...byName];
  const [only] = groups;
  if (groups.length === 1 && only !== undefined && only[1].length === FORMAT_IDS.length) {
    return `${only[0]} for every format`;
  }
  if (groups.length === 0) return "(none)";
  return groups.map(([name, ids]) => `${name} (${ids.join(", ")})`).join(", ");
}

/** A repo-relative snapshot path's directory under `SNAPSHOTS_DIR` and file name. */
function splitSnapshotPath(path: string): { dir: string; file: string } {
  const [dir = "", ...rest] = path.slice(SNAPSHOTS_DIR.length + 1).split("/");
  return { dir, file: rest.join("/") };
}

/** The snapshot directories once `--write`'s planned writes and removals are applied. */
function snapshotsAfter(
  state: SchemasState,
  writes: ReadonlyMap<string, string>,
  removals: ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const snapshots = new Map<string, Map<string, string>>();
  for (const [dir, files] of state.snapshots) snapshots.set(dir, new Map(files));
  for (const [path, content] of writes) {
    const { dir, file } = splitSnapshotPath(path);
    const files = snapshots.get(dir) ?? new Map<string, string>();
    files.set(file, content);
    snapshots.set(dir, files);
  }
  for (const path of removals) {
    const { dir, file } = splitSnapshotPath(path);
    snapshots.get(dir)?.delete(file);
  }
  return snapshots;
}

function releaseModuleOf(state: SchemasState): string {
  return renderReleaseModule({ packageVersion: state.packageVersion });
}

/** Every finding, one `✗ …` line each; empty when the derived files are current. */
export function checkSchemas(state: SchemasState): string[] {
  const findings: string[] = [];
  const index = `${PACKAGE_DIR}/${GENERATED_INDEX}`;
  if (state.generatedIndex !== generatedIndexOf(state)) {
    findings.push(
      `✗ ${index} does not match package.json version ${state.packageVersion}, first ` +
        `supported release ${state.firstSupportedRelease ?? "(none)"} and current shapes ` +
        `${describeCurrentShapes(state.currentShapes)} — run ${WRITE_COMMAND}`,
    );
  }
  findings.push(...currentShapeNames(state.snapshots).findings);
  if (state.releaseModule !== releaseModuleOf(state)) {
    findings.push(
      `✗ ${RELEASE_MODULE} does not match package.json version ${state.packageVersion} — ` +
        `run ${WRITE_COMMAND}`,
    );
  }
  const { mismatched } = refreshLock(state.lock, state.historyFiles);
  for (const path of state.historyFiles.keys()) {
    if (state.lock[path] === undefined) {
      findings.push(`✗ ${path} has no ${LOCK_PATH} entry — run ${WRITE_COMMAND}`);
    }
  }
  for (const path of mismatched) {
    findings.push(
      `✗ ${path} differs from its ${LOCK_PATH} entry — a frozen module never changes; ` +
        `restore it, or, before its first release only, delete its entry and run ${WRITE_COMMAND}`,
    );
  }
  for (const path of Object.keys(state.lock)) {
    if (!state.historyFiles.has(path)) {
      findings.push(`✗ ${LOCK_PATH} names ${path}, which does not exist — restore the module`);
    }
  }
  return [...findings, ...checkSnapshots(state)];
}

/**
 * What `--write` produces: the generated index, phax's release module, the
 * lock with missing entries added, and the snapshot files to write (repo-relative path →
 * content) or remove. The index names the current shapes the snapshots record
 * once those writes and removals are applied, so one `--write` leaves the
 * check green. `mismatched` lists the lock entries it refused to change; when
 * it is non-empty nothing is written.
 */
export function writeSchemas(state: SchemasState): {
  generatedIndex: string;
  releaseModule: string;
  lock: string;
  mismatched: ReadonlyArray<string>;
  snapshotWrites: ReadonlyMap<string, string>;
  snapshotRemovals: ReadonlyArray<string>;
} {
  const { lock, mismatched } = refreshLock(state.lock, state.historyFiles);
  const { writes, removals } = planSnapshotWrites(state);
  const currentShapes = currentShapeNames(snapshotsAfter(state, writes, removals)).names;
  return {
    generatedIndex: generatedIndexOf(state, currentShapes),
    releaseModule: releaseModuleOf(state),
    lock: renderLock(lock),
    mismatched,
    snapshotWrites: writes,
    snapshotRemovals: removals,
  };
}

/** Writes `content` to the repo-relative `path` under `repoRoot`; true when its bytes changed. */
function writeIfChanged(repoRoot: string, path: string, content: string): boolean {
  const target = join(repoRoot, path);
  if (existsSync(target) && readFileSync(target, "utf8") === content) return false;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return true;
}

/**
 * Applies `writeSchemas` to the tree at `repoRoot`: the generated index,
 * phax's release module, the lock, and the snapshot writes and removals.
 * When a frozen module differs from its lock entry it writes nothing and
 * returns those paths in `mismatched`. `changed` lists, sorted, the
 * repo-relative paths it wrote or removed whose content actually changed.
 */
export function applySchemasWrite(repoRoot: string): {
  readonly mismatched: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
} {
  const written = writeSchemas(readSchemasState(repoRoot));
  if (written.mismatched.length > 0) return { mismatched: written.mismatched, changed: [] };
  const changed: string[] = [];
  const files: ReadonlyArray<readonly [string, string]> = [
    [`${PACKAGE_DIR}/${GENERATED_INDEX}`, written.generatedIndex],
    [RELEASE_MODULE, written.releaseModule],
    [LOCK_PATH, written.lock],
    ...written.snapshotWrites,
  ];
  for (const [path, content] of files) {
    if (writeIfChanged(repoRoot, path, content)) changed.push(path);
  }
  for (const path of written.snapshotRemovals) {
    rmSync(join(repoRoot, path));
    changed.push(path);
  }
  return { mismatched: [], changed: changed.toSorted() };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = join(fileURLToPath(import.meta.url), "../..");
  if (process.argv.includes("--write")) {
    const { mismatched, changed } = applySchemasWrite(repoRoot);
    if (mismatched.length > 0) {
      for (const path of mismatched) {
        console.error(`✗ ${path} differs from its ${LOCK_PATH} entry — nothing written`);
      }
      process.exit(1);
    }
    console.log(`Wrote ${PACKAGE_DIR}/${GENERATED_INDEX}, ${RELEASE_MODULE} and ${LOCK_PATH}`);
    for (const path of changed.filter((entry) => entry.startsWith(`${SNAPSHOTS_DIR}/`))) {
      console.log(`${existsSync(join(repoRoot, path)) ? "Wrote" : "Removed"} ${path}`);
    }
  } else {
    const state = readSchemasState(repoRoot);
    const findings = checkSchemas(state);
    for (const finding of findings) console.error(finding);
    if (findings.length > 0) process.exit(1);
    console.log("Schemas package derived files are current");
  }
}
