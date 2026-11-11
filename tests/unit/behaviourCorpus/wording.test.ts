// No captured refusal carries Effect's description of a whole type: a value that
// should have been an object or an array reads in phax's words (`Expected an
// object, actual …`), so the Effect 4 migration never has to reproduce Effect 3's
// type printer (operator decision of 2026-11-07, at the corpus review). Effect-free
// like the replay test: it reads the case files only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listCaseFiles, parseCaseFile } from "../../behaviourCorpus/corpus.js";

const casesRoot = fileURLToPath(new URL("../../behaviourCorpus/cases/", import.meta.url));
// Effect's descriptions of a whole type: an object or array type, a tuple, or one
// side of a transformed struct.
const WHOLE_TYPE = /Expected (\{ |ReadonlyArray<|readonly \[)|\((Encoded|Type) side\)/;
// A member of a union of JSON literals, which keeps today's `"a" | "b"` form;
// `null` and `undefined` count as literals.
const LITERAL = /^("(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*|true|false|null|undefined)$/;
const EXPECTED = /Expected (.+?), actual /g;

// A union with a member that is not a literal reads `Expected one of …`; any other
// `a | b` label with such a member is an unprefixed Effect union description.
function unprefixedUnion(refusal: string): boolean {
  return [...refusal.matchAll(EXPECTED)].some(([, label = ""]) => {
    if (label.startsWith("one of ")) return false;
    const members = label.split(" | ");
    return members.length > 1 && !members.every((member) => LITERAL.test(member));
  });
}

describe("behaviour corpus wording", () => {
  for (const path of listCaseFiles(casesRoot)) {
    const file = parseCaseFile(readFileSync(path, "utf8"), path);
    it(`${file.subject} captures no Effect whole-type or union description`, () => {
      const offending = file.cases
        .filter(({ expected }) => expected !== null && !expected.ok)
        .filter(
          ({ expected }) =>
            expected !== null &&
            !expected.ok &&
            (WHOLE_TYPE.test(expected.refusal) || unprefixedUnion(expected.refusal)),
        )
        .map(({ name }) => name);
      expect(offending).toEqual([]);
    });
  }
});
