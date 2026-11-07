// No captured refusal carries Effect's description of a whole type: a value that
// should have been an object or an array reads in phax's words (`Expected an
// object, actual …`), so the Effect 4 migration never has to reproduce Effect 3's
// type printer (operator decision of 2026-11-07, at the corpus review). Effect-free
// like the replay test: it reads the case files only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listCaseFiles, parseCaseFile } from "../../effect4Corpus/corpus.js";

const casesRoot = fileURLToPath(new URL("../../effect4Corpus/cases/", import.meta.url));
const WHOLE_TYPE = /Expected (\{ |ReadonlyArray<)/;

describe("behaviour corpus wording", () => {
  for (const path of listCaseFiles(casesRoot)) {
    const file = parseCaseFile(readFileSync(path, "utf8"), path);
    it(`${file.subject} captures no Effect whole-type description`, () => {
      const offending = file.cases
        .filter(({ expected }) => expected !== null && !expected.ok)
        .filter(
          ({ expected }) => expected !== null && !expected.ok && WHOLE_TYPE.test(expected.refusal),
        )
        .map(({ name }) => name);
      expect(offending).toEqual([]);
    });
  }
});
