// Fills the behaviour corpus's missing expectations on Effect 3: every case
// under tests/effect4Corpus/cases/ whose `expected` is null gets what phax's
// decoder answers for its input today. A captured expectation is never
// changed, and the script refuses to run unless the installed `effect` major
// is 3, so a later tree can only replay the corpus, never re-record it.
// Run: pnpm exec tsx scripts/effect4-corpus-capture.ts
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureFile,
  caseFileText,
  listCaseFiles,
  parseCaseFile,
} from "../tests/effect4Corpus/corpus.js";
import { replay } from "../tests/effect4Corpus/subjects.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const casesRoot = join(root, "tests", "effect4Corpus", "cases");

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

function main(): number {
  const major = installedEffectMajor();
  let filled = 0;
  let files = 0;
  for (const path of listCaseFiles(casesRoot)) {
    const source = relative(root, path);
    const text = readFileSync(path, "utf8");
    const outcome = captureFile(parseCaseFile(text, source), replay, major);
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
  return 0;
}

process.exitCode = main();
