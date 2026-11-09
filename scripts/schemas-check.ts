// Checks the schemas package's derived files against their sources:
// packages/schemas/src/generated/index.ts against the root package.json
// version, the lowest release-named snapshot and every format's current shape
// name (`next`, else its highest release-named snapshot), phax's src/schemas/release.ts
// against the root package.json version (PHAX_RELEASE) and every format's
// current stamp (CURRENT_STAMPS: its highest release-named snapshot, or the
// package.json version while a `next` snapshot exists — a drifted stamp is
// reported by format), packages/schemas/history.lock.json
// against the bytes of every frozen module under phax's src/schemas/history/
// (keyed by repo-relative path), every format's JSON Schema snapshots
// under packages/schemas/snapshots/<format id>/ against the schema its
// current decoder renders, judged against a released snapshot by the
// format's corpus documents (packages/schemas/build/equivalence.ts), and
// packages/schemas/shipped-json.json, the JSON Schemas the package ships,
// against the same rendering. `--write` is
// `applySchemasWrite(root)`, which the release cut (scripts/release-cut.ts)
// also runs on the tree it cuts; it sets the shipped entry of a format whose
// `next` snapshot it records to the generated schema.
// Check: pnpm exec tsx scripts/schemas-check.ts
// Write: pnpm exec tsx scripts/schemas-check.ts --write
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeEquivalence } from "../packages/schemas/build/equivalence.js";
import {
  WRITE_COMMAND,
  currentStamps,
  refreshLock,
  renderGeneratedIndex,
  renderLock,
  renderReleaseModule,
  type HistoryLock,
} from "../packages/schemas/build/generated.js";
import {
  FORMAT_DEFINITIONS,
  JSON_SCHEMA_FORMATS,
  RECORD_MANIFEST_MEMBERS,
  SHIPPED_JSON_PATH,
  parseShippedJson,
  renderJsonSchemas,
  renderShippedJson,
  shipsGenerated,
  type ShippedJson,
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
import { isCaseFile, parseCorpusFile } from "../tests/effect4Corpus/corpus.js";

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
  /**
   * Format id (and `record-manifest`) → its corpus documents, the inputs of
   * tests/effect4Corpus/cases/formats/<id>.json, which judge a generated
   * schema against a released one. An injected state may leave them out.
   */
  readonly documents?: ReadonlyMap<string, ReadonlyArray<unknown>>;
  /**
   * packages/schemas/shipped-json.json, with every rendered file of the JSON
   * Schema table it is judged against. An injected state may leave it out;
   * the check then does not read it.
   */
  readonly shipped?: ShippedState;
}

export interface ShippedState {
  /** The parsed file, or why it could not be read. */
  readonly json: ShippedJson | string;
  /** File name → what `renderJsonSchemas` renders for the table entry. */
  readonly generated: ReadonlyMap<string, string>;
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

function renderFormats(
  files: ReadonlyMap<string, string>,
  failures: ReturnType<typeof renderJsonSchemas>["failures"],
): SnapshotFormat[] {
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

const CORPUS_FORMATS_DIR = "tests/effect4Corpus/cases/formats";
/** The repository this script belongs to. */
const OWN_ROOT = join(fileURLToPath(import.meta.url), "../..");

/**
 * Format id → the input of every case in its corpus file (current and every
 * frozen shape), read through the corpus's own loader; `record-manifest` →
 * the union of its members'. A format without a file has no entry.
 */
export function readCorpusDocuments(repoRoot: string): ReadonlyMap<string, ReadonlyArray<unknown>> {
  const documents = new Map<string, ReadonlyArray<unknown>>();
  for (const id of FORMAT_IDS) {
    const path = join(repoRoot, CORPUS_FORMATS_DIR, `${id}.json`);
    if (!existsSync(path)) continue;
    const file = parseCorpusFile(readFileSync(path, "utf8"), path);
    if (isCaseFile(file)) continue;
    documents.set(
      id,
      [...file.current, ...Object.values(file.shapes).flat()].map(({ input }) => input),
    );
  }
  documents.set(
    "record-manifest",
    RECORD_MANIFEST_MEMBERS.flatMap((member) => documents.get(member) ?? []),
  );
  return documents;
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
  const rendered = renderJsonSchemas(JSON_SCHEMA_FORMATS);
  const shippedPath = join(repoRoot, SHIPPED_JSON_PATH);
  return {
    packageVersion: rootManifest.version,
    firstSupportedRelease: firstSupportedRelease(snapshots.snapshots),
    currentShapes: currentShapeNames(snapshots.snapshots).names,
    generatedIndex: existsSync(indexPath) ? readFileSync(indexPath, "utf8") : undefined,
    releaseModule: existsSync(releasePath) ? readFileSync(releasePath, "utf8") : undefined,
    lock: existsSync(lockPath) ? (JSON.parse(readFileSync(lockPath, "utf8")) as HistoryLock) : {},
    historyFiles,
    ...snapshots,
    formats: renderFormats(rendered.files, rendered.failures),
    // The corpus judges this process's renderings, so it is read beside this
    // script, like the schemas it renders, whatever tree is checked.
    documents: readCorpusDocuments(OWN_ROOT),
    // A tree without shipped-json.json (a partial copy) is not checked for it.
    ...(existsSync(shippedPath)
      ? {
          shipped: {
            json: parseShippedJson(readFileSync(shippedPath, "utf8")),
            generated: rendered.files,
          },
        }
      : {}),
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

function releaseModuleOf(
  state: SchemasState,
  currentShapes: SchemasState["currentShapes"],
): string {
  return renderReleaseModule({ packageVersion: state.packageVersion, currentShapes });
}

/** Format id → stamp, read line by line from a release module's `CURRENT_STAMPS` entries. */
function committedStamps(releaseModule: string): ReadonlyMap<string, string> {
  const stamps = new Map<string, string>();
  for (const [, quoted, bare, stamp] of releaseModule.matchAll(
    /^ {2}(?:"([^"]+)"|([A-Za-z_$][\w$]*)): "([^"]*)",$/gm,
  )) {
    const id = quoted ?? bare;
    if (id !== undefined && stamp !== undefined) stamps.set(id, stamp);
  }
  return stamps;
}

/**
 * One finding per format whose committed `CURRENT_STAMPS` entry differs from
 * the stamp the snapshots and package.json give it, or is missing.
 */
function stampFindings(state: SchemasState, releaseModule: string): string[] {
  const committed = committedStamps(releaseModule);
  const expected = currentStamps(state);
  return FORMAT_IDS.flatMap((id) => {
    const want = expected[id];
    const have = committed.get(id);
    if (want === undefined || have === want) return [];
    return [
      `✗ ${RELEASE_MODULE} stamps ${id} with ${have ?? "no stamp"}, but its current stamp is ` +
        `${want} — run ${WRITE_COMMAND}`,
    ];
  });
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
  if (state.releaseModule !== releaseModuleOf(state, state.currentShapes)) {
    const drifted =
      state.releaseModule === undefined ? [] : stampFindings(state, state.releaseModule);
    findings.push(
      ...(drifted.length > 0
        ? drifted
        : [
            `✗ ${RELEASE_MODULE} does not match package.json version ${state.packageVersion} — ` +
              `run ${WRITE_COMMAND}`,
          ]),
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
    if (state.historyFiles.has(path)) continue;
    findings.push(
      isRetiredModule(path)
        ? `✗ ${LOCK_PATH} names ${path}, a module of a retired format — run ${WRITE_COMMAND}`
        : `✗ ${LOCK_PATH} names ${path}, which does not exist — restore the module`,
    );
  }
  return [...findings, ...checkSnapshots(state), ...shippedFindings(state)];
}

/** The format ids whose current shape `snapshots` records as `next`. */
function nextFormatsOf(
  snapshots: ReadonlyMap<string, ReadonlyMap<string, string>>,
): ReadonlySet<string> {
  const { names } = currentShapeNames(snapshots);
  return new Set(FORMAT_IDS.filter((id) => names[id] === "next"));
}

function parsedOrNull(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * One finding per shipped-json.json entry the build would ship wrong: a table
 * file without an entry, an entry no table file names, an entry of a format
 * that ships its generated schema (`shipsGenerated`) that is not that schema
 * byte for byte, and an entry of any other format the equivalence judge does
 * not find equivalent to its generated schema over the format's corpus
 * documents.
 */
function shippedFindings(state: SchemasState): string[] {
  const { shipped } = state;
  if (shipped === undefined) return [];
  if (typeof shipped.json === "string") {
    return [`✗ ${SHIPPED_JSON_PATH} cannot be read: ${shipped.json}`];
  }
  const json = shipped.json;
  const nextFormats = nextFormatsOf(state.snapshots);
  const findings: string[] = [];
  for (const entry of JSON_SCHEMA_FORMATS) {
    const content = json[entry.fileName];
    const generated = shipped.generated.get(entry.fileName);
    if (content === undefined) {
      findings.push(`✗ ${SHIPPED_JSON_PATH} has no ${entry.fileName} entry — run ${WRITE_COMMAND}`);
      continue;
    }
    // A format that failed to render is reported by the snapshot check.
    if (generated === undefined) continue;
    if (shipsGenerated(entry.format, nextFormats)) {
      if (content !== generated) {
        findings.push(
          `✗ ${SHIPPED_JSON_PATH}: ${entry.fileName} is not the generated schema its next ` +
            `snapshot ships — run ${WRITE_COMMAND}`,
        );
      }
      continue;
    }
    const verdict = judgeEquivalence({
      released: parsedOrNull(content),
      generated: parsedOrNull(generated),
      documents: state.documents?.get(entry.format) ?? [],
    });
    if (!verdict.equivalent) {
      findings.push(
        `✗ ${SHIPPED_JSON_PATH}: ${entry.fileName} is not equivalent to the generated schema ` +
          `(${verdict.disagreements.length} corpus documents judged differently` +
          `${verdict.problem === null ? "" : `; ${verdict.problem}`}) — record the format's next ` +
          `snapshot (run ${WRITE_COMMAND})`,
      );
    }
  }
  const fileNames = new Set(JSON_SCHEMA_FORMATS.map(({ fileName }) => fileName));
  for (const fileName of Object.keys(json)) {
    if (!fileNames.has(fileName)) {
      findings.push(
        `✗ ${SHIPPED_JSON_PATH} names ${fileName}, which no format ships — run ${WRITE_COMMAND}`,
      );
    }
  }
  return findings;
}

/**
 * shipped-json.json once `--write` has run, given the formats whose current
 * shape is `next` after its snapshot writes: an entry per table file, the
 * generated schema for a format that ships it or had no entry, the entry
 * kept otherwise. Undefined when the state has no readable shipped-json.json.
 */
function shippedAfter(
  state: SchemasState,
  nextFormats: ReadonlySet<string>,
): ShippedJson | undefined {
  const { shipped } = state;
  if (shipped === undefined || typeof shipped.json === "string") return undefined;
  const json = shipped.json;
  const after: Record<string, string> = {};
  for (const entry of JSON_SCHEMA_FORMATS) {
    const kept = shipsGenerated(entry.format, nextFormats) ? undefined : json[entry.fileName];
    const content = kept ?? shipped.generated.get(entry.fileName) ?? json[entry.fileName];
    if (content !== undefined) after[entry.fileName] = content;
  }
  return after;
}

/** True when `path` is a frozen module under a directory that names no current format id. */
function isRetiredModule(path: string): boolean {
  const [formatId = ""] = path.slice(HISTORY_DIR.length + 1).split("/");
  return !(FORMAT_IDS as ReadonlyArray<string>).includes(formatId);
}

/** `lock` without the entries of deleted modules of retired formats. */
function withoutRetired(
  lock: HistoryLock,
  historyFiles: SchemasState["historyFiles"],
): HistoryLock {
  return Object.fromEntries(
    Object.entries(lock).filter(([path]) => historyFiles.has(path) || !isRetiredModule(path)),
  );
}

/**
 * What `--write` produces: the generated index, phax's release module, the
 * lock with missing entries added and the entries of a retired format's
 * deleted modules dropped (a directory under src/schemas/history/ that names
 * no current format id), and the snapshot files to write (repo-relative path →
 * content) or remove, then shipped-json.json, whose entry of a format that is
 * `next` once those apply (for record-manifest, one of its members) becomes
 * its generated schema. The index names the current shapes the snapshots
 * record once those writes and removals are applied, so one `--write` leaves
 * the check green. `mismatched` lists the lock entries it refused to change;
 * when it is non-empty nothing is written.
 */
export function writeSchemas(state: SchemasState): {
  generatedIndex: string;
  releaseModule: string;
  lock: string;
  mismatched: ReadonlyArray<string>;
  snapshotWrites: ReadonlyMap<string, string>;
  snapshotRemovals: ReadonlyArray<string>;
  /** shipped-json.json's content, when the state reads it. */
  shippedJson: string | undefined;
} {
  const { lock, mismatched } = refreshLock(
    withoutRetired(state.lock, state.historyFiles),
    state.historyFiles,
  );
  const { writes, removals } = planSnapshotWrites(state);
  const snapshots = snapshotsAfter(state, writes, removals);
  const currentShapes = currentShapeNames(snapshots).names;
  const shipped = shippedAfter(state, nextFormatsOf(snapshots));
  return {
    generatedIndex: generatedIndexOf(state, currentShapes),
    releaseModule: releaseModuleOf(state, currentShapes),
    lock: renderLock(lock),
    mismatched,
    snapshotWrites: writes,
    snapshotRemovals: removals,
    shippedJson: shipped === undefined ? undefined : renderShippedJson(shipped),
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
 * phax's release module, the lock, the snapshot writes and removals, and
 * shipped-json.json.
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
    ...(written.shippedJson === undefined
      ? []
      : [[SHIPPED_JSON_PATH, written.shippedJson] as const]),
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
