// Fills the behaviour corpus's missing expectations on Effect 3: every case
// under tests/effect4Corpus/cases/ whose `expected` is null gets what phax's
// decoder answers for its input today. A captured expectation is never
// changed, and the script refuses to run unless the installed `effect` major
// is 3, so a later tree can only replay the corpus, never re-record it. It also
// writes the schemas package's baseline under tests/effect4Corpus/baseline/ (its
// runtime export names and the SHA-256 of every released snapshot), each file
// only when absent.
// Run: pnpm exec tsx scripts/effect4-corpus-capture.ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureCorpusFile,
  caseFileText,
  listCaseFiles,
  parseCorpusFile,
} from "../tests/effect4Corpus/corpus.js";
import { replay } from "../tests/effect4Corpus/subjects.js";
import * as schemasPackage from "../packages/schemas/src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const casesRoot = join(root, "tests", "effect4Corpus", "cases");
const baselineRoot = join(root, "tests", "effect4Corpus", "baseline");
const snapshotsRoot = join(root, "packages", "schemas", "snapshots");

function installedEffectMajor(): number {
  const manifest: unknown = JSON.parse(
    readFileSync(join(root, "node_modules", "effect", "package.json"), "utf8"),
  );
  const version =
    typeof manifest === "object" && manifest !== null && "version" in manifest
      ? manifest.version
      : undefined;
  if (typeof version !== "string")
    throw new Error("node_modules/effect/package.json has no version");
  const major = Number(version.split(".")[0]);
  if (!Number.isInteger(major)) throw new Error(`unreadable effect version ${version}`);
  return major;
}

/** Every file under `dir`, recursively, as absolute paths. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function writeIfAbsent(name: string, text: string): boolean {
  const path = join(baselineRoot, name);
  if (existsSync(path)) return false;
  mkdirSync(baselineRoot, { recursive: true });
  writeFileSync(path, text);
  return true;
}

/** The package's runtime export names, sorted, as the baseline file holds them. */
function packageExportsText(): string {
  return JSON.stringify(Object.keys(schemasPackage).toSorted(), null, 2) + "\n";
}

/** Repo-relative path to SHA-256 for every released snapshot, keys sorted. */
function snapshotDigestsText(): string {
  const digests = filesUnder(snapshotsRoot)
    .map((path) => relative(root, path).split(sep).join("/"))
    .toSorted()
    .map((path): [string, string] => [
      path,
      createHash("sha256")
        .update(readFileSync(join(root, path)))
        .digest("hex"),
    ]);
  return JSON.stringify(Object.fromEntries(digests), null, 2) + "\n";
}

function main(): number {
  const major = installedEffectMajor();
  let filled = 0;
  let files = 0;
  for (const path of listCaseFiles(casesRoot)) {
    const source = relative(root, path);
    const text = readFileSync(path, "utf8");
    const outcome = captureCorpusFile(parseCorpusFile(text, source), replay, major);
    if (outcome.kind === "refused") {
      process.stderr.write(`effect4-corpus-capture: refused: ${outcome.reason}\n`);
      return 1;
    }
    const next = caseFileText(outcome.file);
    if (next !== text) {
      writeFileSync(path, next);
      files += 1;
    }
    filled += outcome.filled;
  }
  process.stdout.write(`effect4-corpus-capture: filled ${filled} expectations in ${files} files\n`);
  for (const [name, text] of [
    ["package-exports.json", packageExportsText()],
    ["snapshot-digests.json", snapshotDigestsText()],
  ] as const) {
    if (writeIfAbsent(name, text))
      process.stdout.write(`effect4-corpus-capture: wrote baseline/${name}\n`);
  }
  return 0;
}

process.exitCode = main();
