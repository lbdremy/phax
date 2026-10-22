// The two verdicts. Each returns `{ findings }` in the request's file order,
// then source order, or `{ refused: { reason, remedy } }` for a request it
// cannot judge.
import { fileAt, fileNow } from "./git.mjs";
import { parse, strippedProgram, testsOf } from "./syntax.mjs";

// One rule per finding kind, which is also the prefix of the finding's id.
const RULES = {
  "oracle-unmarked":
    "In the oracle phase, every test added or modified in an oracle file carries the runner's expected-failure marker",
  "oracle-not-run":
    "In the oracle phase, every test added or modified in an oracle file runs: no skip, todo, only, skipIf or runIf on it or an enclosing block, and a test function",
  "oracle-marker-left":
    "After the oracle phase, no test of an oracle file keeps the runner's expected-failure marker",
  "oracle-changed":
    "After the oracle phase, only the expected-failure markers may change in an oracle file",
  "oracle-unparsable": "An oracle file parses",
};

function finding(kind, file, subject, lines, message) {
  return {
    id: subject === undefined ? `${kind}:${file}` : `${kind}:${file}:${subject}`,
    rule: RULES[kind],
    location: { file, lines },
    message,
    related: [],
    guide: null,
  };
}

function unparsable(file, error) {
  return finding(
    "oracle-unparsable",
    file,
    undefined,
    [error.line, error.line],
    `${file} does not parse (line ${error.line}): ${error.message}`,
  );
}

/** Judge the oracle phase: a new or modified test carries a marker. */
export function authoredFindings(cwd, request) {
  const findings = [];
  for (const file of request.files) {
    const now = fileNow(cwd, file);
    if (now === null) continue;
    const parsed = parse(file, now);
    if (parsed.error !== undefined) {
      findings.push(unparsable(file, parsed.error));
      continue;
    }
    // A base file that is absent, or does not parse, has no test to compare with.
    const baseText = fileAt(cwd, request.base, file);
    const baseParsed = baseText === null ? undefined : parse(file, baseText);
    const baseTrees = new Map(
      baseParsed?.program === undefined
        ? []
        : testsOf(baseParsed.program, baseText).map((test) => [test.identity, test.tree]),
    );
    for (const test of testsOf(parsed.program, now)) {
      if (baseTrees.get(test.identity) === test.tree) continue;
      const how = baseTrees.has(test.identity) ? "modified" : "new";
      // A marked test that never runs passes both verdicts and judges no code.
      if (test.notRun !== null) {
        findings.push(
          finding(
            "oracle-not-run",
            file,
            test.identity,
            [test.start, test.end],
            `Test "${test.identity}" is ${how} since the base commit and ${test.notRun}, so it never judges the code`,
          ),
        );
      }
      if (test.marked) continue;
      findings.push(
        finding(
          "oracle-unmarked",
          file,
          test.identity,
          [test.start, test.end],
          `Test "${test.identity}" is ${how} since the base commit and carries no .fails marker`,
        ),
      );
    }
  }
  return { findings };
}

/** The first difference between two test lists, named, or null when no test differs. */
function firstTestDifference(nowTests, thenTests) {
  const before = new Map(thenTests.map((test) => [test.identity, test.tree]));
  for (const test of nowTests) {
    if (!before.has(test.identity)) return `test "${test.identity}" was added`;
    if (before.get(test.identity) !== test.tree) return `test "${test.identity}" was modified`;
  }
  const after = new Set(nowTests.map((test) => test.identity));
  const deleted = thenTests.find((test) => !after.has(test.identity));
  return deleted === undefined ? null : `test "${deleted.identity}" was deleted`;
}

/** Judge the discharging phase: no marker left, and nothing else changed since `oracleCommit`. */
export function dischargedFindings(cwd, request) {
  const findings = [];
  for (const file of request.files) {
    const now = fileNow(cwd, file);
    const thenText = fileAt(cwd, request.oracleCommit, file);
    if (now === null && thenText === null) continue;

    let thenParsed;
    if (thenText !== null) {
      thenParsed = parse(file, thenText);
      if (thenParsed.error !== undefined) {
        return {
          refused: {
            reason: `${file} does not parse at the oracle commit ${request.oracleCommit} (line ${thenParsed.error.line}): ${thenParsed.error.message}`,
            remedy: `Correct the oracle in the phase's worktree, then run phax resume <run> --skip-oracle; the fix loop cannot repair a committed oracle.`,
          },
        };
      }
    }
    if (now === null) {
      findings.push(
        finding(
          "oracle-changed",
          file,
          undefined,
          null,
          `${file} was deleted since the oracle commit`,
        ),
      );
      continue;
    }
    const parsed = parse(file, now);
    if (parsed.error !== undefined) {
      findings.push(unparsable(file, parsed.error));
      continue;
    }
    const nowTests = testsOf(parsed.program, now);
    for (const test of nowTests) {
      if (!test.marked) continue;
      findings.push(
        finding(
          "oracle-marker-left",
          file,
          test.identity,
          [test.start, test.end],
          `Test "${test.identity}" still carries a .fails marker (line ${test.markerLines[0]})`,
        ),
      );
    }
    if (thenParsed === undefined) {
      findings.push(
        finding(
          "oracle-changed",
          file,
          undefined,
          null,
          `${file} was added since the oracle commit`,
        ),
      );
    } else if (strippedProgram(parsed.program) !== strippedProgram(thenParsed.program)) {
      const thenTests = testsOf(thenParsed.program, thenText);
      const difference =
        firstTestDifference(nowTests, thenTests) ?? "the change lies outside any test";
      findings.push(
        finding(
          "oracle-changed",
          file,
          undefined,
          null,
          `${file} changed since the oracle commit beyond its markers: ${difference}`,
        ),
      );
    }
  }
  return { findings };
}
