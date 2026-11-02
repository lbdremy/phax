// The two verdicts. Each returns `{ findings }` in the request's file order,
// then source order, or `{ refused: { reason, remedy } }` for a request it
// cannot judge.
import { fileAt, fileNow } from "./git.mjs";
import { parse, strippedProgram, testsOf } from "./syntax.mjs";

// One rule per finding kind, which is also the prefix of the finding's id.
const RULES = {
  "acceptance-unmarked":
    "In the acceptance phase, every test added or modified in an acceptance test file carries the runner's expected-failure marker",
  "acceptance-not-run":
    "In the acceptance phase, every test added or modified in an acceptance test file runs: no skip, todo, only, skipIf or runIf on it or an enclosing block, and a test function",
  "acceptance-marker-left":
    "After the acceptance phase, no test of an acceptance test file keeps the runner's expected-failure marker",
  "acceptance-changed":
    "After the acceptance phase, only the expected-failure markers may change in an acceptance test file",
  "acceptance-unparsable": "An acceptance test file parses",
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
    "acceptance-unparsable",
    file,
    undefined,
    [error.line, error.line],
    `${file} does not parse (line ${error.line}): ${error.message}`,
  );
}

/** Judge the acceptance phase: a new or modified test carries a marker. */
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
            "acceptance-not-run",
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
          "acceptance-unmarked",
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

/** Judge the passing phase: no marker left, and nothing else changed since `acceptanceCommit`. */
export function passedFindings(cwd, request) {
  const findings = [];
  for (const file of request.files) {
    const now = fileNow(cwd, file);
    const thenText = fileAt(cwd, request.acceptanceCommit, file);
    if (now === null && thenText === null) continue;

    let thenParsed;
    if (thenText !== null) {
      thenParsed = parse(file, thenText);
      if (thenParsed.error !== undefined) {
        return {
          refused: {
            reason: `${file} does not parse at the acceptance commit ${request.acceptanceCommit} (line ${thenParsed.error.line}): ${thenParsed.error.message}`,
            remedy: `Correct the acceptance test in the phase's worktree, then run phax resume <run> --skip-acceptance; the fix loop cannot repair a committed acceptance test.`,
          },
        };
      }
    }
    if (now === null) {
      findings.push(
        finding(
          "acceptance-changed",
          file,
          undefined,
          null,
          `${file} was deleted since the acceptance commit`,
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
          "acceptance-marker-left",
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
          "acceptance-changed",
          file,
          undefined,
          null,
          `${file} was added since the acceptance commit`,
        ),
      );
    } else if (strippedProgram(parsed.program) !== strippedProgram(thenParsed.program)) {
      const thenTests = testsOf(thenParsed.program, thenText);
      const difference =
        firstTestDifference(nowTests, thenTests) ?? "the change lies outside any test";
      findings.push(
        finding(
          "acceptance-changed",
          file,
          undefined,
          null,
          `${file} changed since the acceptance commit beyond its markers: ${difference}`,
        ),
      );
    }
  }
  return { findings };
}
