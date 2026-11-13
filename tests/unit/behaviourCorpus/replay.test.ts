// Replays the behaviour corpus: every case under tests/behaviourCorpus/cases/
// decodes to the expectation captured on Effect 3, compared through the
// canonical encoder, a refusal naming the running schemas package's version and
// a `next` shape the release that cut it, once its release ledger lists it.
// Effect-free and subject-free: it walks the case files, so a case file added
// later is replayed without an edit here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  expectedAt,
  listCaseFiles,
  parseCaseFile,
  parseReleaseLedger,
  readTargetInput,
  subjectOfPath,
  type ReplayTree,
  type CaseFile,
} from "../../behaviourCorpus/corpus.js";
import { replay } from "../../behaviourCorpus/subjects.js";
import { PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";

const casesRoot = fileURLToPath(new URL("../../behaviourCorpus/cases/", import.meta.url));
const ledgerPath = fileURLToPath(
  new URL("../../../packages/schemas/releases.json", import.meta.url),
);

const tree: ReplayTree = {
  packageVersion: PACKAGE_VERSION,
  releases: parseReleaseLedger(readFileSync(ledgerPath, "utf8"), ledgerPath),
};

/** The document a case decodes: a format case's input names its target beside it. */
function documentOf(subject: string, input: unknown): unknown {
  return subject.startsWith("formats/") ? readTargetInput(input).document : input;
}

const files: ReadonlyArray<{ readonly path: string; readonly file: CaseFile }> = listCaseFiles(
  casesRoot,
).map((path) => ({ path, file: parseCaseFile(readFileSync(path, "utf8"), path) }));

describe("behaviour corpus", () => {
  it("holds case files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const { path, file } of files) {
    it(`${file.subject} names its own path and gives each case a distinct name`, () => {
      expect(file.subject).toBe(subjectOfPath(casesRoot, path));
      const names = file.cases.map((c) => c.name);
      expect(new Set(names).size).toBe(names.length);
    });

    for (const c of file.cases) {
      it(`${file.subject} ${c.name}`, () => {
        if (c.expected === null) {
          throw new Error(
            `${file.subject} ${c.name}: no captured expectation; the corpus records Effect 3's answers (see CONTRIBUTING.md, "The behaviour corpus")`,
          );
        }
        expect(canonicalJson(replay(file.subject, c.input))).toBe(
          canonicalJson(expectedAt(c.expected, tree, documentOf(file.subject, c.input))),
        );
      });
    }
  }

  // The refusal lines the migration spec quotes (its "cli: refusal lines" surface).
  // The spec abbreviates the first: phax's line goes on to list the keys
  // expected (`version: is unexpected, expected: …`).
  it("holds the spec's refusal lines among its captured refusals", () => {
    const refusals = files.flatMap(({ file }) =>
      file.cases.flatMap((c) => (c.expected?.ok === false ? [c.expected.refusal] : [])),
    );
    const lines = refusals.flatMap((refusal) => refusal.split("\n"));
    expect(
      lines.some((line) => line.startsWith("$schema: is missing; version: is unexpected")),
    ).toBe(true);
    expect(lines).toContain("acceptanceCriteria[2].refs[0]: is missing");
    expect(lines).toContain('  gate step "pnpm test": output must be "log" or "gate-report"');
  });
});
