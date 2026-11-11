// Replays the behaviour corpus: every case under tests/behaviourCorpus/cases/
// decodes to the expectation captured on Effect 3, compared through the
// canonical encoder, a refusal naming the running schemas package's version.
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
  subjectOfPath,
  type CaseFile,
} from "../../behaviourCorpus/corpus.js";
import { replay } from "../../behaviourCorpus/subjects.js";
import { PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";

const casesRoot = fileURLToPath(new URL("../../behaviourCorpus/cases/", import.meta.url));

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
          canonicalJson(expectedAt(c.expected, PACKAGE_VERSION)),
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
